import { execFileSync } from 'node:child_process'
import { mkdtemp, readdir, readFile, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { buildResearchMcp } from '../../../tools/local-mcp/build.mjs'

it('delivers research MCP processes that relocate, validate input and close with their host', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agnes-research-mcp-'))
  try {
    const output = join(root, 'built')
    await buildResearchMcp(output)
    const relocated = join(root, 'relocated')
    await rename(output, relocated)
    const entry = join(relocated, 'research-metadata-server.cjs')
    const check = fileURLToPath(new URL('../../../tools/local-mcp/check.mjs', import.meta.url))
    const result = execFileSync(process.execPath, [check], {
      cwd: root,
      env: { ...process.env, RESEARCH_MCP_ENTRY: entry },
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30_000,
    })
    expect(result).toContain('doi: stdio initialization, 4 tools and refusal checks passed')
    expect(result).toContain('zenodo: stdio initialization, 2 tools and refusal checks passed')
    const notices = join(relocated, 'research-metadata-notices')
    expect(await readFile(join(notices, 'Agnes-Science-Apache-2.0.txt'), 'utf8')).toContain('Apache License')
    expect(await readdir(join(notices, 'THIRD-PARTY-NOTICES'))).toEqual(
      expect.arrayContaining(['modelcontextprotocol-sdk.txt', 'ajv.txt', 'zod.txt']),
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 45_000)
