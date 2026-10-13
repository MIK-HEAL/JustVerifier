import { PassThrough } from 'node:stream'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js'
import Ajv from 'ajv/dist/2020.js'
import { doiTools, ParserEngine, zenodoTools } from './connectors.mjs'

const groups = new Map([
  ['doi', doiTools],
  ['zenodo', zenodoTools],
])
const validate = new Ajv({ strict: true, allErrors: false, coerceTypes: false })
const schemas = new Map([...groups.values()].flat().map((tool) => [tool, validate.compile(tool.input)]))
const upstreamHosts = new Set(['api.crossref.org', 'api.datacite.org', 'zenodo.org'])
const lifetime = new AbortController()

// Only fixed public metadata APIs, GET requests and redirects within that same set.
const fetchMetadata = async (input, init) => {
  if (init?.method && init.method !== 'GET') throw new Error('Only metadata GET requests are supported')
  let url = new URL(input)
  for (let attempt = 0; attempt < 5; attempt++) {
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      (url.port && url.port !== '443') ||
      !upstreamHosts.has(url.hostname)
    )
      throw new Error('Unsupported metadata endpoint')
    const response = await fetch(url, { ...init, redirect: 'manual' })
    if (![301, 302, 303, 307, 308].includes(response.status)) return response
    const location = response.headers.get('location')
    await response.body?.cancel()
    if (!location) throw new Error('Metadata redirect has no location')
    url = new URL(location, url)
  }
  throw new Error('Too many metadata redirects')
}
const engine = new ParserEngine({
  fetchImpl: fetchMetadata,
  timeoutMs: 15_000,
  totalTimeoutMs: 30_000,
  maxResponseBytes: 1024 * 1024,
  retries: 1,
})

function mcpServer(group) {
  const tools = groups.get(group)
  const server = new Server({ name: `research-${group}`, version: '1.0.0' }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((tool) => ({
      name: tool.id,
      description: tool.description,
      inputSchema: tool.input,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    })),
  }))
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const tool = tools.find((tool) => tool.id === request.params.name)
    if (!tool) throw new McpError(ErrorCode.InvalidParams, 'Unknown metadata tool')
    const args = request.params.arguments ?? {}
    if (!schemas.get(tool)(args))
      throw new McpError(ErrorCode.InvalidParams, 'Arguments do not match the tool input schema')
    try {
      const result = await engine.call(tool, args, {}, AbortSignal.any([extra.signal, lifetime.signal]))
      const text = JSON.stringify(result)
      if (Buffer.byteLength(text) > 1024 * 1024) throw new Error('Metadata result exceeds 1 MiB')
      return { content: [{ type: 'text', text }] }
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: String(error.message).slice(0, 1024) }] }
    }
  })
  return server
}

const group = process.argv[2]
if (!groups.has(group)) throw new Error('Select a research metadata server: doi or zenodo')
const server = mcpServer(group)
const input = new PassThrough()
let bytes = 0
// Keep an incomplete stdio frame from accumulating without a bound.
process.stdin.on('data', (chunk) => {
  for (const byte of chunk) {
    bytes = byte === 10 ? 0 : bytes + 1
    if (bytes > 64 * 1024) {
      console.error('MCP request exceeds 64 KiB')
      process.exitCode = 1
      void shutdown()
      return
    }
  }
  input.write(chunk)
})
let stopping = false
async function shutdown() {
  if (stopping) return
  stopping = true
  lifetime.abort()
  await server.close()
  input.destroy()
  process.stdin.destroy()
}
process.stdin.once('end', () => void shutdown())
process.stdin.once('error', () => void shutdown())
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void shutdown())
void server.connect(new StdioServerTransport(input, process.stdout)).catch((error) => {
  console.error(error.message)
  process.exitCode = 1
  void shutdown()
})
