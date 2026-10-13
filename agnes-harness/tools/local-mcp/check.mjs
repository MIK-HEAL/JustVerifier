import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const harness = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(resolve(harness, 'packages/base/package.json'))
const { Client } = require('@modelcontextprotocol/sdk/client/index.js')
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js')
const entry = resolve(
  process.env.RESEARCH_MCP_ENTRY ?? resolve(harness, 'packages/cli/dist/local/research-metadata-server.cjs'),
)
const live = process.argv.includes('--live')

for (const [group, count] of [
  ['doi', 4],
  ['zenodo', 2],
]) {
  const client = new Client({ name: 'research-mcp-check', version: '1.0.0' })
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry, group],
    cwd: dirname(entry),
    stderr: 'pipe',
  })
  let errors = ''
  transport.stderr?.on('data', (chunk) => {
    errors += chunk
  })
  try {
    await client.connect(transport)
    const catalog = await client.listTools()
    assert.equal(catalog.tools.length, count)
    assert(catalog.tools.every((tool) => tool.annotations.readOnlyHint))
    await assert.rejects(client.callTool({ name: catalog.tools[0].name, arguments: {} }), /input schema/)
    await assert.rejects(client.callTool({ name: 'unknown_tool', arguments: {} }), /Unknown metadata tool/)
    if (live) {
      const calls =
        group === 'doi'
          ? [
              { name: 'crossref_get_work', arguments: { doi: '10.1145/3292500.3330701' } },
              { name: 'datacite_get_record', arguments: { doi: '10.48550/arXiv.1706.03762' } },
            ]
          : [{ name: 'search_records', arguments: { query: 'reproducibility', page_size: 1 } }]
      for (const call of calls) {
        const result = await client.callTool(call, undefined, { timeout: 40_000 })
        assert(!result.isError, result.content?.[0]?.text)
        const data = JSON.parse(result.content[0].text)
        if (group === 'doi')
          assert.equal((data.doi ?? data.record.doi).toLowerCase(), call.arguments.doi.toLowerCase())
        else assert(Array.isArray(data.records) && data.records.length > 0)
        console.log(`${call.name}: live upstream retrieval succeeded`)
      }
    }
    console.log(`${group}: stdio initialization, ${count} tools and refusal checks passed`)
  } catch (error) {
    throw new Error(`${error.message} ${errors}`)
  } finally {
    await client.close()
    assert.equal(transport.pid, null, 'MCP child must be reaped on disconnect')
  }
}
