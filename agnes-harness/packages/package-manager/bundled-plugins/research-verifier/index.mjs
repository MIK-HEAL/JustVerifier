const Kind = Symbol.for('TypeBox.Kind')
const parameters = {
  [Kind]: 'Object',
  type: 'object',
  additionalProperties: false,
  properties: {},
  required: [],
}

const multiAgentStartInput = {
  [Kind]: 'Object',
  type: 'object',
  additionalProperties: false,
  required: ['prompt', 'plan'],
  properties: {
    prompt: { type: 'string', minLength: 1, maxLength: 32_000 },
    session_id: { type: 'string', minLength: 1, maxLength: 256 },
    agent_prompts: { type: 'object', additionalProperties: { type: 'string', maxLength: 8_000 } },
    plan: { type: 'object', additionalProperties: true },
  },
}

const multiAgentStartOutput = {
  [Kind]: 'Object',
  type: 'object',
  additionalProperties: false,
  required: ['run_id', 'status', 'plan_checksum'],
  properties: {
    run_id: { type: 'string' },
    status: { type: 'string', enum: ['queued'] },
    plan_checksum: { type: 'string' },
    trace: { type: 'array', items: { type: 'object', additionalProperties: true } },
  },
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(',')}}`
  return JSON.stringify(value)
}

async function checksum(value) {
  const bytes = new TextEncoder().encode(stable(value))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

function planErrors(plan) {
  const errors = []
  if (!plan || typeof plan !== 'object') return ['plan']
  const agentRows = Array.isArray(plan.agents) ? plan.agents : []
  const agents = new Set(agentRows.map((agent) => agent?.agent_id))
  const tasks = new Map(Array.isArray(plan.tasks) ? plan.tasks.map((task) => [task?.task_id, task]) : [])
  if (!agents.has(plan.root_agent_id)) errors.push('root_agent_id')
  else if (agentRows.find((agent) => agent?.agent_id === plan.root_agent_id)?.role !== 'planner') errors.push('root_agent_id.role')
  for (const task of tasks.values()) {
    if (!task?.agent_id || !agents.has(task.agent_id)) errors.push(`${task?.task_id ?? 'task'}.agent_id`)
    if (!task?.output_namespace?.startsWith(`${task?.agent_id}/`)) errors.push(`${task?.task_id ?? 'task'}.output_namespace`)
    for (const dependency of task?.depends_on ?? []) if (!tasks.has(dependency)) errors.push(`${task.task_id}.depends_on`)
  }
  const pending = new Map([...tasks].map(([id, task]) => [id, (task.depends_on ?? []).length]))
  const ready = [...pending].filter(([, count]) => count === 0).map(([id]) => id)
  let visited = 0
  while (ready.length) {
    const id = ready.shift()
    visited += 1
    for (const [taskId, task] of tasks) {
      if (!(task.depends_on ?? []).includes(id)) continue
      const count = (pending.get(taskId) ?? 0) - 1
      pending.set(taskId, count)
      if (count === 0) ready.push(taskId)
    }
  }
  if (visited !== tasks.size) errors.push('tasks.cycle')
  return [...new Set(errors)].sort()
}

/**
 * Discovery surface for the deterministic verifier package. Verification itself remains in the
 * workspace package and CLI; this row only advertises the governed capability and never invents a
 * pass result when the verifier service is unavailable.
 */
export const researchVerifier = {
  inject: ['extension'],
  apply(ctx) {
    ctx.services.register({
      name: 'research.multi-agent.start',
      kind: 'effect',
      inputSchema: multiAgentStartInput,
      outputSchema: multiAgentStartOutput,
      timeoutMs: 10_000,
      maxResultBytes: 32_768,
      async handler(input) {
        const errors = planErrors(input?.plan)
        if (errors.length) {
          const error = new Error(`invalid multi-agent plan: ${errors.join(', ')}`)
          error.code = 'INVALID_MULTI_AGENT_PLAN'
          throw error
        }
        const plan = { ...input.plan }
        const planChecksum = await checksum(Object.fromEntries(Object.entries(plan).filter(([key]) => key !== 'checksum')))
        const runId = `research-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
        return {
          run_id: runId,
          status: 'queued',
          plan_checksum: planChecksum,
          trace: [
            { kind: 'plan.accepted', run_id: runId, plan_checksum: planChecksum },
            { kind: 'verification.queued', run_id: runId, task_count: plan.tasks?.length ?? 0 },
          ],
        }
      },
    })
    ctx.extension().registerTool({
      name: 'research_verifier_status',
      description: 'Report the installed deterministic research verifier capability and schemas.',
      parameters,
      meta: {
        isReadOnly: true,
        isDestructive: false,
        isConcurrencySafe: true,
        isOpenWorld: false,
        replay: 'safe',
        costHint: {},
        deferLoading: false,
        requiresApproval: 'never',
      },
      async execute() {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                package: '@agnes/research-verifier',
                version: '0.1.0',
                ruleset: 'research-verifier-p0@1',
                status: 'available',
                verification: 'deterministic-local',
                schemas: ['certificate', 'manifest', 'report', 'multi-agent-plan'],
              }),
            },
          ],
        }
      },
    })
  },
}
