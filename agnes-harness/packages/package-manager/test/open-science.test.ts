import { expect, it } from 'vitest'

const { openScience } = await import(
  new URL('../bundled-plugins/open-science/index.mjs', import.meta.url).href
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

it('registers native scientific tools without an MCP forwarding call', async () => {
  const tools: CapturedTool[] = []
  const disposers: (() => void)[] = []
  openScience.apply({
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
  openScience.apply({
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
