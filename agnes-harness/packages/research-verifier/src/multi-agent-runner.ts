import type { VerificationInput } from './index.js'
import {
  type AgentAttempt,
  type AgentFinding,
  type AgentTask,
  aggregateMultiAgentFindings,
  type MultiAgentAggregation,
  type MultiAgentPlan,
  queueAgentAttempt,
  type ReviewerSnapshot,
  readyMultiAgentTasks,
  validateMultiAgentPlan,
} from './multi-agent.js'
import { immutable, validateAgentAttempts } from './multi-agent-validation.js'

export type AgentDelegateResult = Readonly<{
  output_artifact_ids?: readonly string[]
  findings?: readonly AgentFinding[]
  reviewer_snapshots?: readonly ReviewerSnapshot[]
  usage?: Readonly<{ credits?: number; steps?: number }>
}>
export type AgentDelegate = (
  input: Readonly<{
    task: AgentTask
    attempt: AgentAttempt
    dependencies: readonly AgentAttempt[]
    signal: AbortSignal
  }>,
) => Promise<AgentDelegateResult>

/** The caller owns execution and ledger I/O; scheduling and final verification remain in the harness. */
export async function runMultiAgentPlan(
  input: Readonly<{
    plan: MultiAgentPlan
    delegate: AgentDelegate
    verification?: VerificationInput
    max_concurrency?: number
    signal?: AbortSignal
  }>,
): Promise<MultiAgentAggregation> {
  const plan = immutable(input.plan)
  const errors = validateMultiAgentPlan(plan)
  if (errors.length) throw new Error(`invalid multi-agent plan: ${errors.join(', ')}`)
  const concurrency = input.max_concurrency ?? 4
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new Error('invalid max_concurrency')
  // Copy verification evidence before delegates run, preventing later mutation of the final witness.
  const verification = input.verification ? immutable(input.verification) : undefined
  const attempts: AgentAttempt[] = []
  const findings: AgentFinding[] = []
  const snapshots: ReviewerSnapshot[] = []
  const execute = async (task: AgentTask): Promise<void> => {
    const queued = queueAgentAttempt(plan, task.task_id, { attempt_id: `attempt-${task.task_id}` })
    const index = attempts.length
    attempts.push(queued)
    if (input.signal?.aborted) {
      attempts[index] = immutable({ ...queued, status: 'cancelled' })
      return
    }
    const dependencies = immutable(attempts.filter((attempt) => task.depends_on?.includes(attempt.task_id)))
    const running = immutable({
      ...queued,
      status: 'running' as const,
      input_artifact_ids: [
        ...new Set([
          ...queued.input_artifact_ids,
          ...dependencies.flatMap((attempt) => attempt.output_artifact_ids),
        ]),
      ].sort(),
    })
    attempts[index] = running
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let onAbort: (() => void) | undefined
    const stop = new Promise<never>((_, reject) => {
      onAbort = () => {
        controller.abort(input.signal?.reason)
        reject(new Error('CANCELLED'))
      }
      input.signal?.addEventListener('abort', onAbort, { once: true })
      if (task.budget?.timeout_ms !== undefined)
        timer = setTimeout(() => {
          controller.abort(new Error('TIMEOUT'))
          reject(new Error('TIMEOUT'))
        }, task.budget.timeout_ms)
    })
    try {
      const result = immutable(
        await Promise.race([
          Promise.resolve().then(() => {
            controller.signal.throwIfAborted()
            return input.delegate({
              task,
              attempt: running,
              dependencies,
              signal: controller.signal,
            })
          }),
          stop,
        ]),
      )
      for (const [key, limit, amount] of [
        ['credits', task.budget?.credits, result.usage?.credits],
        ['steps', task.budget?.max_steps, result.usage?.steps],
      ] as const) {
        if (
          amount !== undefined &&
          (!Number.isFinite(amount) || amount < 0 || (key === 'steps' && !Number.isSafeInteger(amount)))
        )
          throw new Error('INVALID_USAGE')
        if (limit !== undefined && (amount === undefined || amount > limit))
          throw new Error(`BUDGET_${key.toUpperCase()}`)
      }
      const completed: AgentAttempt = immutable({
        ...running,
        status: 'completed',
        output_artifact_ids: result.output_artifact_ids ?? [],
      })
      const attemptErrors = validateAgentAttempts(
        plan,
        attempts.map((attempt, at) => (at === index ? completed : attempt)),
      )
      if (attemptErrors.length) throw new Error(`INVALID_RESULT: ${attemptErrors.join(', ')}`)
      if (
        result.findings?.some(
          (finding) => finding.attempt_id !== completed.attempt_id || finding.agent_id !== completed.agent_id,
        )
      )
        throw new Error('INVALID_FINDING_BINDING')
      attempts[index] = completed
      findings.push(...(result.findings ?? []))
      snapshots.push(...(result.reviewer_snapshots ?? []))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      attempts[index] = immutable({
        ...running,
        status: input.signal?.aborted ? 'cancelled' : 'failed',
        error: { code: message.split(':')[0] ?? 'DELEGATE_FAILED', message },
      })
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      if (onAbort) input.signal?.removeEventListener('abort', onAbort)
    }
  }
  while (attempts.length < plan.tasks.length) {
    const ready = readyMultiAgentTasks(plan, attempts).slice(0, concurrency)
    if (!ready.length || input.signal?.aborted) {
      for (const task of plan.tasks.filter(
        (task) => !attempts.some((attempt) => attempt.task_id === task.task_id),
      )) {
        attempts.push(
          immutable({
            ...queueAgentAttempt(plan, task.task_id, { attempt_id: `attempt-${task.task_id}` }),
            status: input.signal?.aborted ? 'cancelled' : 'blocked',
            error: {
              code: input.signal?.aborted ? 'CANCELLED' : 'DEPENDENCY_FAILED',
              message: 'Task was not executed.',
            },
          }),
        )
      }
      break
    }
    await Promise.all(ready.map(execute))
  }
  return aggregateMultiAgentFindings(plan, attempts, findings, {
    ...(verification ? { verification } : {}),
    reviewer_snapshots: snapshots,
  })
}
