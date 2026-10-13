import { copyFile, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectThirdPartyNotices } from '../third-party-notices.mjs'

const harness = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(resolve(harness, 'node_modules/.pnpm/node_modules/package.json'))
const { build } = require('esbuild')

/** Self-contained entry: no source checkout, node_modules or manual service at runtime. */
export async function buildResearchMcp(outputDirectory) {
  const result = await build({
    entryPoints: [resolve(harness, 'tools/local-mcp/server.mjs')],
    outfile: resolve(outputDirectory, 'research-metadata-server.cjs'),
    nodePaths: [resolve(harness, 'node_modules/.pnpm/node_modules')],
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'cjs',
    metafile: true,
    legalComments: 'eof',
  })
  const notices = resolve(outputDirectory, 'research-metadata-notices')
  await collectThirdPartyNotices(harness, notices, [result])
  await mkdir(notices, { recursive: true })
  await copyFile(resolve(harness, '../open-science/LICENSE'), resolve(notices, 'Open-Science-Apache-2.0.txt'))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildResearchMcp(resolve(process.argv[2] ?? resolve(harness, 'packages/cli/dist/local')))
  console.log('Built bundled research metadata MCP servers.')
}
