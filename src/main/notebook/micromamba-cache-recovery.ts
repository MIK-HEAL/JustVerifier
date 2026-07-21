import { type Dirent, existsSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'

import { WINDOWS_MAX_USABLE_PATH } from './micromamba-cache'

const COMPLETE_MARKER = join('info', 'repodata_record.json')
const CONDA_SUBDIR = /^(?:noarch|win-64|osx-(?:64|arm64)|linux-(?:64|aarch64|ppc64le|s390x))$/i
const CONFIRMED_MAX_PATH_PACKAGE = /^libstdcxx-devel_win-64-/i

const directories = (path: string): Dirent[] => {
  try {
    return readdirSync(path, { withFileTypes: true }).filter((entry) => entry.isDirectory())
  } catch {
    return []
  }
}

const removeIfIncomplete = (dir: string): boolean => {
  if (existsSync(join(dir, COMPLETE_MARKER))) return false
  rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  return true
}

const removeIncompleteUrlLeaves = (urlRoot: string): boolean => {
  let removed = false
  const walk = (dir: string): void => {
    for (const entry of directories(dir)) {
      const child = join(dir, entry.name)
      if (CONDA_SUBDIR.test(basename(dir))) {
        removed = removeIfIncomplete(child) || removed
      } else {
        walk(child)
      }
    }
  }
  walk(urlRoot)
  return removed
}

export const removeIncompleteExtractedPackages = (cacheDirs: string[]): boolean => {
  let removed = false
  for (const cacheDir of new Set(cacheDirs.map((dir) => resolve(dir)))) {
    for (const entry of directories(cacheDir)) {
      if (entry.name === 'cache') continue
      const dir = join(cacheDir, entry.name)
      if (/^https?$/i.test(entry.name)) {
        removed = removeIncompleteUrlLeaves(dir) || removed
      } else {
        removed = removeIfIncomplete(dir) || removed
      }
    }
  }
  return removed
}

export type MaxPathRecoveryDeps = {
  platform?: NodeJS.Platform
  canonicalize?: (path: string) => string
  remove?: (path: string) => void
  // Required for remove_all evidence: unlike a concrete missing-file path, that message does not
  // contain the over-limit leaf. The staged pack metadata supplies the exact cache budget instead.
  maxCacheRelativePath?: number
}

const archiveLeaf = (value: string): string | undefined => {
  const leaf = basename(value).replace(/(?:\.conda|\.tar\.bz2)$/i, '')
  return /^[A-Za-z0-9][A-Za-z0-9_.+-]*$/.test(leaf) ? leaf : undefined
}

const containedBy = (root: string, target: string): boolean => {
  const rel = relative(root, target)
  return rel !== '' && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel)
}

const quotedPaths = (message: string): string[] =>
  [...message.matchAll(/['"]([^'"\r\n]+)['"]/g)].map((match) => match[1])

export const recoverWindowsMaxPathPackage = (
  error: unknown,
  allowedCacheRoots: string[],
  deps: MaxPathRecoveryDeps = {}
): boolean => {
  if ((deps.platform ?? process.platform) !== 'win32') return false
  const message = error instanceof Error ? error.message : String(error)
  const hasMissingContext =
    /invalid package cache/i.test(message) && /(?:is missing|package cache error)/i.test(message)
  const hasRemoveContext =
    /error when extracting package/i.test(message) &&
    /remove_all[^]*(?:not empty|directory)/i.test(message)
  if (!hasMissingContext && !hasRemoveContext) return false

  const archiveMatch = message.match(/(?:for|cache for)\s+['"]([^'"]+\.(?:conda|tar\.bz2))['"]/i)
  const expectedLeaf = archiveMatch ? archiveLeaf(archiveMatch[1]) : undefined
  const paths = quotedPaths(message).filter((value) => value !== archiveMatch?.[1])
  const canonicalize = deps.canonicalize ?? ((path: string) => realpathSync.native(path))
  const roots = allowedCacheRoots.flatMap((root) => {
    try {
      return [canonicalize(resolve(root))]
    } catch {
      return []
    }
  })

  for (const evidencePath of paths) {
    const absoluteEvidence = resolve(evidencePath)
    let candidate = absoluteEvidence
    if (expectedLeaf) {
      const parts = absoluteEvidence.split(sep)
      const index = parts.lastIndexOf(expectedLeaf)
      if (index < 0) continue
      candidate = parts.slice(0, index + 1).join(sep) || sep
    }
    const leaf = archiveLeaf(candidate)
    if (!leaf || (expectedLeaf && leaf !== expectedLeaf)) continue

    let physical: string
    try {
      physical = canonicalize(candidate)
    } catch {
      continue
    }
    const root = roots.find((allowed) => containedBy(allowed, physical))
    if (!root) continue
    const rel = relative(root, physical).split(sep)
    if (!/^https?$/i.test(rel[0]) || rel.length < 5 || rel.at(-1) !== leaf) continue

    const reachesPathLimit = hasMissingContext
      ? absoluteEvidence.length > WINDOWS_MAX_USABLE_PATH
      : CONFIRMED_MAX_PATH_PACKAGE.test(leaf) &&
        Number.isSafeInteger(deps.maxCacheRelativePath) &&
        root.length + (deps.maxCacheRelativePath as number) > WINDOWS_MAX_USABLE_PATH
    if (!reachesPathLimit) continue

    const remove =
      deps.remove ??
      ((path: string): void =>
        rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }))
    remove(physical)
    return true
  }
  return false
}
