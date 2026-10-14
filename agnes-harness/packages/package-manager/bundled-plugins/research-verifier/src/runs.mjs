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
const DEFAULT_TASK_TIMEOUT_MS = 120_000
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
  // A run_id is an idempotent state handle: repeating the call resumes/reads the same
  // execution. Marking this as `never` makes the session layer report "unknown after dispatch"
  // even when the run has already completed.
  replay: 'idempotent',
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
      children: new Map(),
      started: new Map(),
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
      if (!['queued', 'running', 'cancelling'].includes(run.status))
        return { content: [{ type: 'text', text: JSON.stringify(view(run)) }], structured: view(run) }
      const signal = AbortSignal.any([
        run.controller.signal,
        ...(extension.ctx?.signal ? [extension.ctx.signal] : []),
      ])
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
      const updateAttempt = (attempt) => {
        run.attempts.set(attempt.task_id, freeze(attempt))
        append('attempt.changed', { attempt })
      }
      const response = async (terminal = false) => {
        await writes
        const structured = view(run)
        return {
          content: [{ type: 'text', text: JSON.stringify(structured) }],
          structured,
          ...(terminal ? { terminate: true } : {}),
          ...(run.status === 'failed' ? { isError: true } : {}),
        }
      }
      const settle = (status) => {
        const report = verifier.aggregateMultiAgentFindings(run.plan, [...run.attempts.values()], [])
        run.report = report
        run.status = status
        append('run.finished', { status, report })
      }
      const cancelRunning = async () => {
        await Promise.allSettled([...run.children.values()].map((key) => tctx.subagent.cancel(key)))
        run.children.clear()
        for (const attempt of run.attempts.values())
          if (attempt.status === 'running')
            updateAttempt({
              ...attempt,
              status: 'cancelled',
              error: { code: 'CANCELLED', message: 'Task was cancelled.' },
            })
      }
      if (run.status === 'queued') {
        run.status = 'running'
        append('run.started', { plan: run.plan })
      }
      try {
        if (signal.aborted || run.status === 'cancelling') {
          await cancelRunning()
          for (const task of run.plan.tasks.filter((item) => !run.attempts.has(item.task_id)))
            updateAttempt({
              ...verifier.queueAgentAttempt(run.plan, task.task_id, {
                attempt_id: `${run.id}-${task.task_id}`,
              }),
              status: 'cancelled',
              error: { code: 'CANCELLED', message: 'Task was not executed.' },
            })
          settle('cancelled')
          return response(true)
        }

        for (;;) {
          if (signal.aborted || run.status === 'cancelling') {
            await cancelRunning()
            for (const task of run.plan.tasks.filter((item) => !run.attempts.has(item.task_id)))
              updateAttempt({
                ...verifier.queueAgentAttempt(run.plan, task.task_id, {
                  attempt_id: `${run.id}-${task.task_id}`,
                }),
                status: 'cancelled',
                error: { code: 'CANCELLED', message: 'Task was not executed.' },
              })
            settle('cancelled')
            return response(true)
          }
          for (const [taskId, childKey] of [...run.children]) {
            const task = run.plan.tasks.find((item) => item.task_id === taskId)
            const attempt = run.attempts.get(taskId)
            const elapsed = Date.now() - (run.started.get(taskId) ?? Date.now())
            const timeoutMs = task?.budget?.timeout_ms ?? DEFAULT_TASK_TIMEOUT_MS
            if (elapsed >= timeoutMs) {
              await tctx.subagent.cancel(childKey)
              run.children.delete(taskId)
              updateAttempt({ ...attempt, status: 'failed', error: { code: 'TIMEOUT', message: `Agent 超过 ${timeoutMs / 1000} 秒未返回结果。` } })
              continue
            }
            const result = await tctx.subagent.collect(childKey, { wait: true })
            if (Date.now() - (run.started.get(taskId) ?? Date.now()) >= timeoutMs) {
              await tctx.subagent.cancel(childKey)
              run.children.delete(taskId)
              updateAttempt({ ...attempt, status: 'failed', error: { code: 'TIMEOUT', message: `Agent 超过 ${timeoutMs / 1000} 秒未返回结果。` } })
              continue
            }
            if (result.waitTimedOut && result.status === 'running') continue
            run.children.delete(taskId)
            if (result.status !== 'completed') {
              const code = `CHILD_${result.status.toUpperCase()}`
              updateAttempt({ ...attempt, status: 'failed', error: { code, message: code } })
              continue
            }
            const text = result.text ?? ''
            const ref = await tctx.artifacts.put(new TextEncoder().encode(text), {
              mime: 'text/plain',
              name: `${attempt.namespace}/result`,
            })
            const artifact = freeze({
              id: `${attempt.namespace}/result`,
              version: '1',
              checksum: verifier.sha256(text),
              ref,
              // The checksum remains the integrity identity; this bounded preview makes the
              // result inspectable in the UI without requiring a second artifact fetch.
              preview: text.slice(0, 16_000),
            })
            run.artifacts.set(artifact.id, artifact)
            append('artifact.created', { artifact, attempt_id: attempt.attempt_id })
            updateAttempt({ ...attempt, status: 'completed', output_artifact_ids: [artifact.id] })
          }

          const ready = verifier
            .readyMultiAgentTasks(run.plan, [...run.attempts.values()])
            .slice(0, Math.max(0, 4 - run.children.size))
          for (const task of ready) {
            const queued = verifier.queueAgentAttempt(run.plan, task.task_id, {
              attempt_id: `${run.id}-${task.task_id}`,
            })
            const dependencies = [...run.attempts.values()].filter((attempt) =>
              task.depends_on?.includes(attempt.task_id),
            )
            const attempt = freeze({
              ...queued,
              status: 'running',
              input_artifact_ids: [
                ...new Set([
                  ...queued.input_artifact_ids,
                  ...dependencies.flatMap((item) => item.output_artifact_ids),
                ]),
              ].sort(),
            })
            updateAttempt(attempt)
            try {
              const agent = run.plan.agents.find((item) => item.agent_id === task.agent_id)
              if (
                ['reviewer', 'verifier'].includes(agent.role) &&
                tctx.subagent.capabilities?.toolAccess !== 'none'
              )
                fail('REVIEWER_ISOLATION_UNAVAILABLE')
              if (task.budget?.max_steps !== undefined || task.budget?.credits !== undefined)
                fail('BUDGET_ATTESTATION_UNAVAILABLE')
              const inputs = await Promise.all(
                attempt.input_artifact_ids.map(async (artifactId) => {
                  const artifact = run.artifacts.get(artifactId)
                  if (!artifact) fail('INPUT_ARTIFACT_UNAVAILABLE')
                  const text = new TextDecoder().decode(await tctx.artifacts.get(artifact.ref))
                  if (verifier.sha256(text) !== artifact.checksum) fail('INPUT_ARTIFACT_CHECKSUM_MISMATCH')
                  return { ...artifact, text }
                }),
              )
              const spawning = tctx.subagent.spawn(
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
                  // Child agents must not call the orchestration tool recursively. They can
                  // still report their observations and outputs to this harness.
                  toolAccess: 'none',
                },
              )
              let onCallAbort
              const callAborted = new Promise((_, reject) => {
                onCallAbort = () =>
                  reject(
                    Object.assign(new Error('CHILD_CREATION_UNKNOWN'), { code: 'CHILD_CREATION_UNKNOWN' }),
                  )
                tctx.signal?.addEventListener('abort', onCallAbort, { once: true })
                if (tctx.signal?.aborted) onCallAbort()
              })
              let child
              try {
                child = await Promise.race([spawning, callAborted])
              } catch (error) {
                if (tctx.signal?.aborted)
                  void spawning.then((late) => tctx.subagent.cancel(late.childKey)).catch(() => undefined)
                throw error
              } finally {
                if (onCallAbort) tctx.signal?.removeEventListener('abort', onCallAbort)
              }
              run.children.set(task.task_id, child.childKey)
              run.started.set(task.task_id, Date.now())
              append('attempt.child', { attempt_id: attempt.attempt_id, child_key: child.childKey })
            } catch (error) {
              const code = error?.code ?? error?.message ?? 'DELEGATE_FAILED'
              if (code === 'CHILD_CREATION_UNKNOWN') throw error
              updateAttempt({ ...attempt, status: 'failed', error: { code, message: code } })
            }
          }
          if (run.children.size) continue
          if (run.attempts.size === run.plan.tasks.length) {
            const failed = [...run.attempts.values()].some((attempt) =>
              ['failed', 'blocked'].includes(attempt.status),
            )
            settle(failed ? 'failed' : 'completed')
            return response(true)
          }
          if (!ready.length) {
            for (const task of run.plan.tasks.filter((item) => !run.attempts.has(item.task_id)))
              updateAttempt({
                ...verifier.queueAgentAttempt(run.plan, task.task_id, {
                  attempt_id: `${run.id}-${task.task_id}`,
                }),
                status: 'blocked',
                error: { code: 'DEPENDENCY_FAILED', message: 'Task was not executed.' },
              })
            settle('failed')
            return response(true)
          }
        }
      } catch (error) {
        const unknown = (error?.code ?? error?.message) === 'CHILD_CREATION_UNKNOWN'
        if (!unknown) run.controller.abort(error)
        await cancelRunning()
        run.status = unknown ? 'unknown' : 'failed'
        run.error = error?.code ?? error?.message ?? 'RUN_FAILED'
        trace(run, 'run.failed', { reason: run.error })
        return response(true)
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
