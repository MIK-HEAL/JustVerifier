import { createHash } from 'node:crypto'

const Kind = Symbol.for('TypeBox.Kind')

// Keep this schema deliberately open. The Open-Science MCP catalog is versioned independently
// from the Harness package and individual servers add fields over time. Validation of the actual
// remote schema still happens in the MCP row before a call reaches the server.
const argumentsSchema = {
  [Kind]: 'Object',
  type: 'object',
  additionalProperties: true,
  properties: {},
  required: [],
}

const callParameters = {
  [Kind]: 'Object',
  type: 'object',
  additionalProperties: false,
  required: ['arguments'],
  properties: {
    arguments: argumentsSchema,
  },
}

const dynamicCallParameters = {
  [Kind]: 'Object',
  type: 'object',
  additionalProperties: false,
  required: ['serverId', 'tool', 'arguments'],
  properties: {
    serverId: { [Kind]: 'String', type: 'string', minLength: 1, maxLength: 128 },
    tool: { [Kind]: 'String', type: 'string', minLength: 1, maxLength: 128 },
    arguments: argumentsSchema,
  },
}

const servers = Object.freeze({
  'open-science-activity': ['begin_activity_group'],
  'open-science-artifacts': ['write_artifact_file'],
  'open-science-notebook': [
    'ask_user_question',
    'notebook_execute',
    'repl_execute',
    'bash_execute',
    'request_network_access',
    'notebook_state',
    'list_notebook_runtimes',
    'notebook_bind_runtime',
    'notebook_switch_runtime',
    'notebook_restart',
    'notebook_shutdown',
    'inspect_packages',
    'manage_packages',
    'manage_environments',
    'list_memory_categories',
    'search_memories',
  ],
  'open-science-skills': ['request_skill_import'],
  'open-science-plan': ['generate_plan', 'update_step_status'],
  'open-science-literature': ['read_document', 'list_pdf_elements', 'read_pdf_element'],
  'open-science-library': [
    'search_library',
    'read_library_abstract',
    'read_library_pdf',
    'format_references',
    'format_citation_document',
    'prepare_latex_bundle',
    'save_to_inbox',
    'acquire_pdf',
  ],
  'open-science-host-message': ['send_message'],
})

function localToolName(serverId, tool) {
  const slug = serverId.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'server'
  const hash = createHash('sha256').update(serverId, 'utf8').digest('hex').slice(0, 8)
  return `mcp_${slug}_${hash}_${tool.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 24)}`
}

function resultFor(result) {
  if (!result || typeof result !== 'object' || !Array.isArray(result.content))
    return { isError: true, content: [{ type: 'text', text: 'MCP returned an invalid result.' }] }
  return result
}

function validateServerId(serverId) {
  if (!serverId.startsWith('open-science-') || !Object.hasOwn(servers, serverId))
    throw new Error(`Unknown Open-Science MCP server: ${serverId}`)
}

function gatewayTool(serverId, tool) {
  return {
    name: `open_science_${serverId.slice('open-science-'.length).replace(/[^A-Za-z0-9_]/g, '_')}_${tool.replace(/[^A-Za-z0-9_]/g, '_')}`.slice(0, 64),
    description: `Call Open-Science MCP tool ${serverId}/${tool}. Arguments follow the server's MCP schema.`,
    parameters: callParameters,
    meta: {
      isReadOnly: tool.startsWith('read_') || tool.startsWith('list_') || tool.startsWith('search_') || tool === 'notebook_state' || tool === 'inspect_packages',
      isDestructive: false,
      isConcurrencySafe: false,
      isOpenWorld: true,
      replay: 'never',
      costHint: {},
      deferLoading: false,
      requiresApproval: 'never',
    },
    async execute(input, ctx) {
      ctx.signal?.throwIfAborted?.()
      const invoke = ctx.tools?.invoke
      if (typeof invoke !== 'function')
        return { isError: true, content: [{ type: 'text', text: 'MCP runtime is unavailable.' }] }
      try {
        return resultFor(await invoke(localToolName(serverId, tool), input.arguments ?? {}, { signal: ctx.signal }))
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: `MCP ${serverId}/${tool} failed: ${String(error?.message ?? error).slice(0, 500)}` }] }
      }
    },
  }
}

export const openScience = {
  inject: ['extension'],
  apply(ctx) {
    const extension = ctx.extension()
    for (const [serverId, tools] of Object.entries(servers))
      for (const tool of tools) extension.registerTool(gatewayTool(serverId, tool))

    extension.registerTool({
      name: 'open_science_mcp_call',
      description: 'Call a tool from the Open-Science MCP catalog by serverId and tool name. Use this for newly added catalog tools.',
      parameters: dynamicCallParameters,
      meta: {
        isReadOnly: false,
        isDestructive: false,
        isConcurrencySafe: false,
        isOpenWorld: true,
        replay: 'never',
        costHint: {},
        deferLoading: true,
        requiresApproval: 'never',
      },
      async execute(input, toolContext) {
        const invoke = toolContext.tools?.invoke
        if (typeof invoke !== 'function')
          return { isError: true, content: [{ type: 'text', text: 'MCP runtime is unavailable.' }] }
        try {
          validateServerId(input.serverId)
          return resultFor(await invoke(localToolName(input.serverId, input.tool), input.arguments ?? {}, { signal: toolContext.signal }))
        } catch (error) {
          return { isError: true, content: [{ type: 'text', text: `MCP ${input.serverId}/${input.tool} failed: ${String(error?.message ?? error).slice(0, 500)}` }] }
        }
      },
    })
  },
}

export { servers as openScienceMcpCatalog, localToolName as openScienceLocalToolName }
