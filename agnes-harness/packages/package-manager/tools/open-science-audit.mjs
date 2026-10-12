import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../bundled-plugins/open-science/', import.meta.url))
const lockPath = fileURLToPath(new URL('../bundled-plugins/open-science/manifest.lock.json', import.meta.url))
const digest = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`

async function filesUnder(directory) {
  const output = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.name === 'manifest.lock.json') continue
    if (entry.isDirectory()) output.push(...(await filesUnder(path)))
    else if (entry.isFile()) output.push(path)
  }
  return output
}

const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
if (manifest.license !== 'Apache-2.0') throw new Error('open-science license must remain Apache-2.0')
const files = {}
for (const path of (await filesUnder(root)).sort())
  files[relative(root, path).replaceAll('\\', '/')] = digest(await readFile(path))
const snapshot = {
  schemaVersion: 1,
  packageId: manifest.name,
  version: manifest.version,
  license: manifest.license,
  source: 'bundled-plugins/open-science',
  upstream: manifest.source ?? null,
  contributions: (manifest.agnes?.contributions ?? []).map(({ kind, id, path }) => ({ kind, id, path })),
  files,
}
const expected = process.argv.includes('--write')
if (expected) await writeFile(lockPath, `${JSON.stringify(snapshot, null, 2)}\n`)
else {
  try {
    const previous = JSON.parse(await readFile(lockPath, 'utf8'))
    if (JSON.stringify(previous) !== JSON.stringify(snapshot)) {
      console.error(
        JSON.stringify({ state: 'changed', lock: lockPath, previous, current: snapshot }, null, 2),
      )
      process.exitCode = 2
    } else console.log(JSON.stringify({ state: 'clean', lock: lockPath, files: Object.keys(files).length }))
  } catch {
    console.error(`missing or invalid lock: ${lockPath}`)
    process.exitCode = 2
  }
}
