import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  recoverWindowsMaxPathPackage,
  removeIncompleteExtractedPackages
} from './micromamba-cache-recovery'

const makeRoot = (): string => mkdtempSync(join(tmpdir(), 'os-cache-recovery-'))

describe('removeIncompleteExtractedPackages', () => {
  it('uses repodata_record.json and repairs both flat and URL-derived package leaves', () => {
    const cache = makeRoot()
    const flatComplete = join(cache, 'complete-flat')
    const flatIncomplete = join(cache, 'incomplete-flat')
    const urlComplete = join(
      cache,
      'https',
      'conda.example',
      'conda-forge',
      'noarch',
      'complete-url'
    )
    const urlIncomplete = join(
      cache,
      'https',
      'conda.example',
      'conda-forge',
      'win-64',
      'incomplete-url'
    )
    for (const dir of [flatComplete, flatIncomplete, urlComplete, urlIncomplete]) {
      mkdirSync(join(dir, 'info'), { recursive: true })
    }
    writeFileSync(join(flatComplete, 'info', 'repodata_record.json'), '{}')
    writeFileSync(join(flatIncomplete, 'info', 'index.json'), '{}')
    writeFileSync(join(urlComplete, 'info', 'repodata_record.json'), '{}')
    writeFileSync(join(urlIncomplete, 'partial'), 'x')
    mkdirSync(join(cache, 'cache', 'repodata'), { recursive: true })
    writeFileSync(join(cache, 'cache', 'repodata', 'state.json'), '{}')

    expect(removeIncompleteExtractedPackages([cache])).toBe(true)
    expect(existsSync(flatComplete)).toBe(true)
    expect(existsSync(flatIncomplete)).toBe(false)
    expect(existsSync(urlComplete)).toBe(true)
    expect(existsSync(urlIncomplete)).toBe(false)
    expect(existsSync(join(cache, 'cache', 'repodata', 'state.json'))).toBe(true)
  })
})

describe('recoverWindowsMaxPathPackage', () => {
  it('deletes only the parsed package leaf contained by an allowed cache root', () => {
    const cache = makeRoot()
    const leaf = 'libstdcxx-devel_win-64-15.2.0-h0a72980_119'
    const packageDir = join(cache, 'https', 'conda.anaconda.org', 'conda-forge', 'noarch', leaf)
    const sibling = join(cache, 'https', 'conda.anaconda.org', 'conda-forge', 'noarch', 'keep-me')
    mkdirSync(packageDir, { recursive: true })
    mkdirSync(sibling, { recursive: true })
    const missing = join(packageDir, 'Library', 'x'.repeat(280))
    const error = new Error(
      `warning Invalid package cache, file '${missing}' is missing\n` +
        `Cannot find a valid extracted directory cache for '${leaf}.conda'\n` +
        'critical Package cache error.'
    )

    expect(recoverWindowsMaxPathPackage(error, [cache], { platform: 'win32' })).toBe(true)
    expect(existsSync(packageDir)).toBe(false)
    expect(existsSync(sibling)).toBe(true)
  })

  it('refuses traversal, cache-root targets, and ambiguous cache errors', () => {
    const cache = makeRoot()
    const outside = makeRoot()
    const leaf = 'outside-package-1.0-0'
    const outsidePackage = join(outside, 'https', 'host', 'channel', 'noarch', leaf)
    mkdirSync(outsidePackage, { recursive: true })
    const longOutsidePath = join(outsidePackage, 'x'.repeat(280))

    expect(
      recoverWindowsMaxPathPackage(
        new Error(
          `Invalid package cache, file '${longOutsidePath}' is missing for '${leaf}.conda'; Package cache error`
        ),
        [cache],
        { platform: 'win32' }
      )
    ).toBe(false)
    expect(
      recoverWindowsMaxPathPackage(
        new Error(`Error when extracting package: remove_all: not empty: "${cache}"`),
        [cache],
        { platform: 'win32' }
      )
    ).toBe(false)
    expect(
      recoverWindowsMaxPathPackage(new Error('Invalid package cache'), [cache], {
        platform: 'win32'
      })
    ).toBe(false)
    expect(existsSync(outsidePackage)).toBe(true)
  })

  it('requires the supplied pack budget before classifying remove_all evidence as MAX_PATH', () => {
    const cache = makeRoot()
    const leaf = 'libstdcxx-devel_win-64-15.2.0-h0a72980_119'
    const packageDir = join(cache, 'https', 'host', 'channel', 'win-64', leaf)
    mkdirSync(packageDir, { recursive: true })
    const error = new Error(`Error when extracting package: remove_all: not empty: "${packageDir}"`)

    expect(recoverWindowsMaxPathPackage(error, [cache], { platform: 'win32' })).toBe(false)
    expect(
      recoverWindowsMaxPathPackage(error, [cache], {
        platform: 'win32',
        maxCacheRelativePath: 500
      })
    ).toBe(true)
    expect(existsSync(packageDir)).toBe(false)
  })

  it('does not apply a pack-wide maximum to an unrelated remove_all package', () => {
    const cache = makeRoot()
    const leaf = 'short-package-1.0-0'
    const packageDir = join(cache, 'https', 'host', 'channel', 'win-64', leaf)
    mkdirSync(packageDir, { recursive: true })

    expect(
      recoverWindowsMaxPathPackage(
        new Error(`Error when extracting package: remove_all: not empty: "${packageDir}"`),
        [cache],
        { platform: 'win32', maxCacheRelativePath: 500 }
      )
    ).toBe(false)
    expect(existsSync(packageDir)).toBe(true)
  })

  it('does not classify the same evidence on non-Windows platforms', () => {
    const cache = makeRoot()
    const leaf = join(cache, 'https', 'host', 'channel', 'noarch', 'pkg-1.0-0')
    mkdirSync(leaf, { recursive: true })
    expect(
      recoverWindowsMaxPathPackage(
        new Error(`Error when extracting package: remove_all: not empty: "${leaf}"`),
        [cache],
        { platform: 'darwin' }
      )
    ).toBe(false)
  })
})
