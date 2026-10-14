import { readdir, readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { BUNDLED_HELPERS } from '../src/bundled-plugin-source.js'

const { agnesScience } = await import(
  new URL('../bundled-plugins/agnes-science/index.mjs', import.meta.url).href
)
type CapturedTool = {
  name: string
  execute(
    args: Record<string, unknown>,
    ctx: Record<string, unknown>,
  ): Promise<{
    content: Array<{ type: string; ref?: unknown }>
    structured?: Record<string, unknown>
  }>
}
const requireTool = (tools: CapturedTool[], name: string): CapturedTool => {
  const tool = tools.find((entry) => entry.name === name)
  if (!tool) throw new Error(`missing tool ${name}`)
  return tool
}

it('registers every migrated Agnes Science Skill with valid Agnes frontmatter', async () => {
  const packageRoot = new URL('../bundled-plugins/agnes-science/', import.meta.url)
  const packageManifest = JSON.parse(await readFile(new URL('package.json', packageRoot), 'utf8'))
  const skillManifest = JSON.parse(await readFile(new URL('skills/manifest.json', packageRoot), 'utf8'))
  const contributions = packageManifest.agnes.contributions.filter(
    (entry: { kind: string }) => entry.kind === 'skill',
  )
  const expectedIds = skillManifest.skills.map((skill: { id: string }) => `agnes-science/${skill.id}`)

  expect(contributions).toHaveLength(expectedIds.length)
  expect(contributions.map((entry: { id: string }) => entry.id).sort()).toEqual([...expectedIds].sort())

  const skillDirectories = (await readdir(new URL('skills/', packageRoot), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  expect(skillDirectories).toEqual(expectedIds.map((id: string) => id.slice('agnes-science/'.length)).sort())

  for (const directory of skillDirectories) {
    const source = await readFile(new URL(`skills/${directory}/SKILL.md`, packageRoot), 'utf8')
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(source)?.[1]
    expect(frontmatter).toBeDefined()
    expect(/^name:\s*(\S.*)$/m.exec(frontmatter ?? '')?.[1]).toBe(directory)
    expect(/^description:\s*(\S.*)$/m.exec(frontmatter ?? '')?.[1]).toBeTruthy()
  }
})

it('ships the plugin as an Agnes bundled helper without Open-Science runtime dependencies', async () => {
  const packageRoot = new URL('../bundled-plugins/agnes-science/', import.meta.url)
  const packageManifest = JSON.parse(await readFile(new URL('package.json', packageRoot), 'utf8'))
  expect(packageManifest.name).toBe('@agnes/agnes-science')
  expect(BUNDLED_HELPERS.some((helper) => helper.id === packageManifest.name)).toBe(true)
  expect(packageManifest.dependencies ?? {}).toEqual({})
  expect(packageManifest.devDependencies ?? {}).toEqual({})
})

it('registers native scientific tools without an MCP forwarding call', async () => {
  const tools: CapturedTool[] = []
  const disposers: (() => void)[] = []
  agnesScience.apply({
    extension: () => ({ registerTool: (tool: CapturedTool) => tools.push(tool) }),
    effect: (factory: () => () => void) => disposers.push(factory()),
  })
  expect(tools.map((tool) => tool.name)).toEqual(
    expect.arrayContaining([
      'science_notebook_execute',
      'science_write_artifact_file',
      'science_read_document',
      'science_search_library',
    ]),
  )
  expect(tools.some((tool) => tool.name === 'open_science_mcp_call')).toBe(false)
  const execute = requireTool(tools, 'science_notebook_execute')
  const result = await execute.execute(
    { code: 'echo native', language: 'shell' },
    {
      signal: new AbortController().signal,
      cwd: process.cwd(),
      timeoutMs: 10000,
      exec: async () => ({ code: 0, stdout: 'native', stderr: '', truncated: false }),
    },
  )
  expect(result.structured?.stdout).toBe('native')
  disposers[0]?.()
})

it('writes artifacts through the Agnes artifact capability with bounded input', async () => {
  const tools: CapturedTool[] = []
  agnesScience.apply({
    extension: () => ({ registerTool: (tool: CapturedTool) => tools.push(tool) }),
    effect: () => () => {},
  })
  const put = async (bytes: Uint8Array, meta: unknown) => ({ id: `artifact-${bytes.byteLength}`, meta })
  const artifactTool = requireTool(tools, 'science_write_artifact_file')
  const result = await artifactTool.execute(
    { filename: 'result.txt', content: 'hello', encoding: 'utf8' },
    { signal: new AbortController().signal, artifacts: { put }, timeoutMs: 10000 },
  )
  expect(result.structured?.size).toBe(5)
  expect(result.content[0]?.type).toBe('ref')
})
