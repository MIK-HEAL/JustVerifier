const Kind = Symbol.for('TypeBox.Kind')
const object = (properties, required = Object.keys(properties)) => ({
  [Kind]: 'Object',
  type: 'object',
  additionalProperties: false,
  properties,
  required,
})
const string = { [Kind]: 'String', type: 'string', minLength: 1, maxLength: 32_000 }
const id = { ...string, maxLength: 256 }
const prompts = { type: 'object', additionalProperties: { type: 'string', maxLength: 8_000 } }
const runInput = object({ run_id: id })
const output = {
  type: 'object',
  additionalProperties: false,
  required: ['run_id', 'status', 'attempts', 'artifacts', 'trace'],
  properties: {
    run_id: { type: 'string' },
    status: {
      type: 'string',
      enum: ['queued', 'running', 'cancelling', 'completed', 'failed', 'cancelled', 'unknown'],
    },
    plan_checksum: { type: 'string' },
    request_checksum: { type: 'string' },
    reason: { type: 'string' },
    attempts: { type: 'array' },
    artifacts: { type: 'array' },
    trace: { type: 'array' },
    report: { type: 'object' },
  },
}
const meta = {
  isReadOnly: false,
  isDestructive: false,
  isConcurrencySafe: false,
  isOpenWorld: true,
  replay: 'never',
  costHint: {},
  deferLoading: false,
  requiresApproval: 'never',
}
const freeze = (value) => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}
const fail = (code, message = code) => {
  throw Object.assign(new Error(message), { code })
}

/** Services admit data only. Execution and evidence writes belong to the active session tool. */
export function registerResearchRuns(ctx, verifier) {
  const extension = ctx.extension()
  const runs = new Map()
  const active = new Set(['queued', 'running', 'cancelling', 'unknown'])
  const expire = (run) => {
    if (run.status === 'queued' && Date.now() - run.created > 60_000) {
      run.status = 'failed'
      run.error = 'DISPATCH_NOT_STARTED'
    }
    return run
  }
  const owner = (context) => context?.sessionId || fail('SESSION_REQUIRED')
  const view = (run) =>
    structuredClone({
      run_id: run.id,
      status: run.status,
      plan_checksum: run.plan.checksum,
      ...(run.request_checksum ? { request_checksum: run.request_checksum } : {}),
      attempts: [...run.attempts.values()],
      artifacts: [...run.artifacts.values()],
      ...(run.report ? { report: run.report } : {}),
      ...(run.error ? { reason: run.error } : {}),
      trace: run.trace,
    })
  const lookup = (runId, session) => {
    const run = runs.get(runId)
    if (!run || run.owner !== session) fail('RUN_NOT_FOUND_OR_RECOVERY_REQUIRED')
    return expire(run)
  }
  const trace = (run, kind, data = {}) => {
    run.trace.push({ kind, run_id: run.id, ...data })
    if (run.trace.length > 64) run.trace.shift()
  }
  const enqueue = (input, session, plan, requestChecksum) => {
    for (const run of runs.values()) expire(run)
    if ([...runs.values()].some((run) => run.owner === session && active.has(run.status))) fail('RUN_BUSY')
    if (runs.size >= 128) {
      const expired = [...runs.values()].find((run) => !active.has(run.status))
      if (!expired) fail('RUN_CAPACITY')
      runs.delete(expired.id)
    }
    const run = {
      id: crypto.randomUUID(),
      owner: session,
      plan: freeze(structuredClone(plan)),
      created: Date.now(),
      input: freeze(structuredClone(input)),
      request_checksum: requestChecksum,
      status: 'queued',
      controller: new AbortController(),
      attempts: new Map(),
      artifacts: new Map(),
      trace: [],
    }
    runs.set(run.id, run)
    trace(run, 'plan.accepted', { plan_checksum: plan.checksum })
    return view(run)
  }
  const register = (name, kind, inputSchema, handler) =>
    ctx.services.register({
      name: `research.multiagent.${name}`,
      kind,
      inputSchema: JSON.parse(JSON.stringify(inputSchema)),
      outputSchema: output,
      timeoutMs: 10_000,
      maxResultBytes: 1_048_576,
      handler,
    })
  register(
    'start',
    'effect',
    object(
      {
        prompt: string,
        plan: { type: 'object', additionalProperties: true },
        agent_prompts: prompts,
        session_id: id,
      },
      ['prompt', 'plan'],
    ),
    async (input, context) => {
      const errors = verifier.validateMultiAgentPlan(input.plan)
      if (!input.prompt.trim() || errors.length) fail('INVALID_MULTI_AGENT_PLAN', errors.join(', '))
      if (input.plan.tasks.length > 256 || input.plan.agents.length > 256) fail('INVALID_MULTI_AGENT_PLAN')
      return enqueue(input, owner(context), input.plan)
    },
  )
  register(
    'direct',
    'effect',
    object(
      {
        prompt: string,
        agent_id: id,
        role: { type: 'string', enum: ['planner', 'executor', 'reviewer', 'verifier'] },
        revision: id,
        session_id: id,
        agent_prompt: { type: 'string', maxLength: 8_000 },
      },
      ['prompt', 'agent_id', 'role'],
    ),
    async (input, context) => {
      if (!input.prompt?.trim() || !['planner', 'executor', 'reviewer', 'verifier'].includes(input.role))
        fail('INVALID_AGENT_REQUEST')
      let plan
      try {
        plan = verifier.buildMultiAgentPlan({
          plan_id: crypto.randomUUID(),
          run_id: crypto.randomUUID(),
          root_agent_id: 'direct-root',
          agents: [
            { agent_id: 'direct-root', role: 'planner', revision: '1', capabilities: [] },
            { agent_id: input.agent_id, role: input.role, revision: input.revision ?? '1', capabilities: [] },
          ],
          tasks: [
            {
              task_id: 'direct',
              agent_id: input.agent_id,
              mode: 'serial',
              output_namespace: `${input.agent_id}/direct`,
            },
          ],
        })
      } catch {
        fail('INVALID_AGENT_REQUEST')
      }
      return enqueue(
        { ...input, agent_prompts: { [input.agent_id]: input.agent_prompt ?? '' } },
        owner(context),
        plan,
        verifier.sha256(input),
      )
    },
  )
  const missing = (runId) => ({
    run_id: runId,
    status: 'unknown',
    reason: 'RUN_NOT_FOUND_OR_RECOVERY_REQUIRED',
    attempts: [],
    artifacts: [],
    trace: [],
  })
  register('status', 'query', runInput, async (input, context) => {
    const run = runs.get(input.run_id)
    return run?.owner === owner(context) ? view(expire(run)) : missing(input.run_id)
  })
  register('cancel', 'effect', runInput, async (input, context) => {
    const run = runs.get(input.run_id)
    if (run?.owner !== owner(context)) return missing(input.run_id)
    expire(run)
    if (['queued', 'running', 'cancelling'].includes(run.status)) {
      run.status = run.status === 'queued' ? 'cancelled' : 'cancelling'
      run.controller.abort(new Error('CANCELLED'))
      trace(run, 'run.cancel.requested')
    }
    return view(run)
  })
  ctx.effect?.(() => () => {
    for (const run of runs.values()) run.controller.abort(new Error('PLUGIN_UNLOADED'))
    runs.clear()
  })
  extension.registerTool({
    name: 'research_multiagent_run',
    description:
      'Execute an immutable queued research run in this session using its run_id. Agent text cannot certify a pass.',
    parameters: runInput,
    meta,
    async execute(input, tctx) {
      const run = lookup(input.run_id, tctx.session.key)
      if (run.status !== 'queued')
        return { content: [{ type: 'text', text: JSON.stringify(view(run)) }], structured: view(run) }
      run.status = 'running'
      const signal = AbortSignal.any([
        run.controller.signal,
        tctx.signal,
        ...(extension.ctx?.signal ? [extension.ctx.signal] : []),
      ])
      const inFlight = new Set()
      const drain = async () => {
        let timer
        try {
          return await Promise.race([
            Promise.allSettled([...inFlight]).then(() => true),
            new Promise((resolve) => {
              timer = setTimeout(() => resolve(false), Math.min(5_000, tctx.timeoutMs ?? 5_000))
            }),
          ])
        } finally {
          clearTimeout(timer)
        }
      }
      let writes = Promise.resolve()
      const append = (kind, data) => {
        trace(run, kind, {
          ...(data.attempt
            ? { attempt: { task_id: data.attempt.task_id, status: data.attempt.status } }
            : {}),
          ...(data.attempt_id ? { attempt_id: data.attempt_id } : {}),
          ...(data.status ? { status: data.status } : {}),
        })
        writes = writes.then(() =>
          extension.events.append(kind.replaceAll('.', '-'), { run_id: run.id, ...data }),
        )
        void writes.catch(() => undefined)
      }
      append('run.started', { plan: run.plan })
      try {
        const report = await verifier.runMultiAgentPlan({
          plan: run.plan,
          signal,
          attempt_prefix: run.id,
          max_concurrency: 4,
          on_attempt: (attempt) => {
            run.attempts.set(attempt.task_id, attempt)
            append('attempt.changed', { attempt })
          },
          delegate: (request) => {
            const execute = async () => {
              const { task, attempt, signal: taskSignal } = request
              const agent = run.plan.agents.find((item) => item.agent_id === task.agent_id)
              if (
                ['reviewer', 'verifier'].includes(agent.role) &&
                tctx.subagent.capabilities?.toolAccess !== 'none'
              )
                fail('REVIEWER_ISOLATION_UNAVAILABLE')
              // This backend does not yet attest step/credit usage through collect.
              if (task.budget?.max_steps !== undefined || task.budget?.credits !== undefined)
                fail('BUDGET_ATTESTATION_UNAVAILABLE')
              const evidence = attempt.input_artifact_ids.map((artifactId) => {
                const artifact = run.artifacts.get(artifactId)
                if (!artifact) fail('INPUT_ARTIFACT_UNAVAILABLE')
                return artifact
              })
              const inputs = await Promise.all(
                evidence.map(async (artifact) => {
                  const text = new TextDecoder().decode(await tctx.artifacts.get(artifact.ref))
                  if (verifier.sha256(text) !== artifact.checksum) fail('INPUT_ARTIFACT_CHECKSUM_MISMATCH')
                  return { ...artifact, text }
                }),
              )
              taskSignal.throwIfAborted()
              const child = await tctx.subagent.spawn(
                JSON.stringify({
                  run_id: run.id,
                  attempt_id: attempt.attempt_id,
                  role: agent.role,
                  task: run.input.prompt,
                  instructions: run.input.agent_prompts?.[agent.agent_id] ?? '',
                  evidence: inputs,
                  evidence_checksum: verifier.sha256(inputs),
                  output_namespace: attempt.namespace,
                  verification_policy:
                    'Report observations and uncertainty. Final certificate verification belongs to the harness.',
                }),
                {
                  isolation: 'shared',
                  ...(['reviewer', 'verifier'].includes(agent.role) ? { toolAccess: 'none' } : {}),
                },
              )
              const cancel = () => {
                void tctx.subagent.cancel(child.childKey).catch(() => undefined)
              }
              taskSignal.addEventListener('abort', cancel, { once: true })
              let finished = false
              try {
                taskSignal.throwIfAborted()
                append('attempt.child', { attempt_id: attempt.attempt_id, child_key: child.childKey })
                const result = await tctx.subagent.collect(child.childKey, { wait: true })
                taskSignal.throwIfAborted()
                if (result.status !== 'completed')
                  fail(result.waitTimedOut ? 'CHILD_TIMEOUT' : `CHILD_${result.status.toUpperCase()}`)
                const text = result.text ?? ''
                const ref = await tctx.artifacts.put(new TextEncoder().encode(text), {
                  mime: 'text/plain',
                  name: `${attempt.namespace}/result`,
                })
                taskSignal.throwIfAborted()
                const artifact = freeze({
                  id: `${attempt.namespace}/result`,
                  version: '1',
                  checksum: verifier.sha256(text),
                  ref,
                })
                run.artifacts.set(artifact.id, artifact)
                append('artifact.created', { artifact, attempt_id: attempt.attempt_id })
                finished = true
                return { output_artifact_ids: [artifact.id] }
              } finally {
                taskSignal.removeEventListener('abort', cancel)
                if (!finished) await tctx.subagent.cancel(child.childKey)
              }
            }
            const pending = execute()
            inFlight.add(pending)
            void pending.finally(() => inFlight.delete(pending)).catch(() => undefined)
            return pending
          },
        })
        if (!(await drain())) fail('CHILD_CLEANUP_UNKNOWN')
        const status = signal.aborted
          ? 'cancelled'
          : report.attempts.some((attempt) => ['failed', 'blocked'].includes(attempt.status))
            ? 'failed'
            : 'completed'
        append('run.finished', { status, report })
        await writes
        run.report = report
        run.status = status
        return {
          content: [{ type: 'text', text: JSON.stringify(view(run)) }],
          structured: view(run),
          terminate: true,
          ...(status === 'failed' ? { isError: true } : {}),
        }
      } catch (error) {
        run.controller.abort(error)
        const drained = await drain()
        run.status = drained ? (tctx.signal.aborted ? 'cancelled' : 'failed') : 'unknown'
        run.error = error?.code ?? error?.message ?? 'RUN_FAILED'
        trace(run, 'run.failed', { reason: run.error })
        await writes.catch(() => undefined)
        return {
          content: [{ type: 'text', text: JSON.stringify(view(run)) }],
          structured: view(run),
          isError: true,
        }
      }
    },
  })
  extension.registerTool({
    name: 'research_verifier_status',
    description: 'Report the installed deterministic verifier and execution adapter.',
    parameters: object({}),
    meta: { ...meta, isReadOnly: true, isOpenWorld: false, isConcurrencySafe: true, replay: 'safe' },
    async execute() {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'available',
              verification: 'deterministic-local',
              execution: 'session-subagent',
              schemas: ['certificate', 'manifest', 'report', 'multi-agent-plan'],
            }),
          },
        ],
      }
    },
  })
}
