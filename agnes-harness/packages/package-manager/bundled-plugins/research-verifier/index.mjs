const Kind = Symbol.for('TypeBox.Kind')
const parameters = {
  [Kind]: 'Object',
  type: 'object',
  additionalProperties: false,
  properties: {},
  required: [],
}

const multiAgentStartInput = {
  type: 'object',
  additionalProperties: false,
  required: ['prompt', 'plan'],
  properties: {
    prompt: { type: 'string', minLength: 1, maxLength: 32_000 },
    session_id: { type: 'string', minLength: 1, maxLength: 256 },
    agent_prompts: { type: 'object', additionalProperties: { type: 'string', maxLength: 8_000 } },
    plan: {
      type: 'object',
      additionalProperties: true,
      maxProperties: 16,
      properties: {
        agents: { type: 'array', maxItems: 256 },
        tasks: { type: 'array', maxItems: 256 },
      },
    },
  },
}

const multiAgentStartOutput = {
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

const multiAgentDirectInput = {
  type: 'object',
  additionalProperties: false,
  required: ['prompt', 'agent_id', 'role'],
  properties: {
    prompt: { type: 'string', minLength: 1, maxLength: 32_000 },
    agent_id: { type: 'string', minLength: 1, maxLength: 256 },
    role: { type: 'string', enum: ['planner', 'executor', 'reviewer', 'verifier'] },
    revision: { type: 'string', minLength: 1, maxLength: 128 },
    session_id: { type: 'string', minLength: 1, maxLength: 256 },
    agent_prompt: { type: 'string', maxLength: 8_000 },
  },
}

const multiAgentDirectOutput = {
  type: 'object',
  additionalProperties: false,
  required: ['run_id', 'status', 'request_checksum'],
  properties: {
    run_id: { type: 'string' },
    status: { type: 'string', enum: ['queued'] },
    request_checksum: { type: 'string' },
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
  const agents = new Set()
  for (const [index, agent] of agentRows.entries()) {
    const id = agent?.agent_id
    if (!id) errors.push(`agents[${index}].agent_id`)
    else if (agents.has(id)) errors.push(`${id}.agent_id.duplicate`)
    else agents.add(id)
  }
  const taskRows = Array.isArray(plan.tasks) ? plan.tasks : []
  const tasks = new Map()
  for (const [index, task] of taskRows.entries()) {
    if (!task || typeof task !== 'object') {
      errors.push(`tasks[${index}]`)
      continue
    }
    const id = task.task_id
    if (!id) {
      errors.push(`tasks[${index}].task_id`)
      continue
    }
    if (tasks.has(id)) {
      errors.push(`${id}.task_id.duplicate`)
      continue
    }
    tasks.set(id, task)
  }
  if (!agents.has(plan.root_agent_id)) errors.push('root_agent_id')
  else if (agentRows.find((agent) => agent?.agent_id === plan.root_agent_id)?.role !== 'planner')
    errors.push('root_agent_id.role')
  for (const task of tasks.values()) {
    if (!task?.agent_id || !agents.has(task.agent_id)) errors.push(`${task?.task_id ?? 'task'}.agent_id`)
    if (!task?.output_namespace?.startsWith(`${task?.agent_id}/`))
      errors.push(`${task?.task_id ?? 'task'}.output_namespace`)
    for (const dependency of Array.isArray(task.depends_on) ? task.depends_on : [])
      if (!tasks.has(dependency)) errors.push(`${task.task_id}.depends_on`)
  }
  const pending = new Map(
    [...tasks].map(([id, task]) => [id, Array.isArray(task.depends_on) ? task.depends_on.length : 0]),
  )
  const dependents = new Map([...tasks].map(([id]) => [id, []]))
  for (const [taskId, task] of tasks) {
    for (const dependency of Array.isArray(task.depends_on) ? task.depends_on : []) {
      dependents.get(dependency)?.push(taskId)
    }
  }
  const ready = [...pending].filter(([, count]) => count === 0).map(([id]) => id)
  let visited = 0
  while (ready.length) {
    const id = ready.shift()
    visited += 1
    for (const taskId of dependents.get(id) ?? []) {
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
      name: 'research.multiagent.start',
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
        const planChecksum = await checksum(
          Object.fromEntries(Object.entries(plan).filter(([key]) => key !== 'checksum')),
        )
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
    ctx.services.register({
      name: 'research.multiagent.direct',
      kind: 'effect',
      inputSchema: multiAgentDirectInput,
      outputSchema: multiAgentDirectOutput,
      timeoutMs: 10_000,
      maxResultBytes: 32_768,
      async handler(input) {
        const requestChecksum = await checksum(input)
        const runId = `research-direct-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
        return {
          run_id: runId,
          status: 'queued',
          request_checksum: requestChecksum,
          trace: [
            {
              kind: 'agent.direct.accepted',
              run_id: runId,
              agent_id: input.agent_id,
              role: input.role,
              request_checksum: requestChecksum,
            },
            { kind: 'agent.direct.queued', run_id: runId, agent_id: input.agent_id },
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
