import { sha256 } from './index.js'
import type { AgentAttempt, MultiAgentPlan, ReviewerSnapshot } from './multi-agent.js'

export const nonempty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0
export const strings = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every(nonempty)
export const namespace = (value: unknown): value is string =>
  nonempty(value) &&
  value.split('/').every((part) => nonempty(part) && part !== '.' && part !== '..') &&
  !value.includes('\\') &&
  [...value].every((char) => char.charCodeAt(0) >= 32)
export const digest = (value: unknown): value is string =>
  typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value)

/** Copy before freezing so caller-owned arrays and nested records cannot mutate signed data. */
export function immutable<T>(value: T): T {
  const copy = structuredClone(value)
  const freeze = (item: unknown): void => {
    if (!item || typeof item !== 'object') return
    for (const child of Object.values(item)) freeze(child)
    Object.freeze(item)
  }
  freeze(copy)
  return copy
}

export function budgetValid(budget: unknown): boolean {
  if (budget === undefined) return true
  if (!budget || typeof budget !== 'object' || Array.isArray(budget)) return false
  return Object.entries(budget).every(
    ([key, value]) =>
      typeof value === 'number' &&
      Number.isFinite(value) &&
      (key === 'credits'
        ? value >= 0
        : ['max_steps', 'timeout_ms'].includes(key) && Number.isSafeInteger(value) && value > 0),
  )
}

export function validateAgentAttempts(
  plan: MultiAgentPlan,
  attempts: readonly AgentAttempt[],
): readonly string[] {
  const errors: string[] = []
  const ids = new Map<string, AgentAttempt>()
  const tasks = new Map(plan.tasks.map((task) => [task.task_id, task]))
  for (const attempt of attempts) {
    const key = `attempts.${attempt.attempt_id}`
    if (
      !namespace(attempt.attempt_id) ||
      attempt.attempt_id.includes('/') ||
      attempt.attempt_id.includes('\\')
    )
      errors.push(`${key}.attempt_id`)
    if (ids.has(attempt.attempt_id)) errors.push(`${key}.duplicate`)
    ids.set(attempt.attempt_id, attempt)
    const task = tasks.get(attempt.task_id)
    if (!task || task.agent_id !== attempt.agent_id) errors.push(`${key}.task_binding`)
    if (
      !namespace(attempt.namespace) ||
      attempt.namespace !== `${task?.output_namespace}/${attempt.attempt_id}`
    )
      errors.push(`${key}.namespace`)
    if (!['queued', 'running', 'completed', 'failed', 'cancelled', 'blocked'].includes(attempt.status))
      errors.push(`${key}.status`)
    if (!strings(attempt.input_artifact_ids) || !strings(attempt.output_artifact_ids)) {
      errors.push(`${key}.artifacts`)
      continue
    }
    if (!(task?.input_artifact_ids ?? []).every((id) => attempt.input_artifact_ids.includes(id)))
      errors.push(`${key}.inputs`)
    const allowedInputs = new Set([
      ...(task?.input_artifact_ids ?? []),
      ...attempts
        .filter((item) => task?.depends_on?.includes(item.task_id) && item.status === 'completed')
        .flatMap((item) => item.output_artifact_ids),
    ])
    if (attempt.input_artifact_ids.some((id) => !allowedInputs.has(id))) errors.push(`${key}.foreign_input`)
    if (attempt.output_artifact_ids.some((id) => !namespace(id) || !id.startsWith(`${attempt.namespace}/`)))
      errors.push(`${key}.outputs`)
    if (attempt.status === 'completed' && attempt.error) errors.push(`${key}.error`)
    if (sha256(attempt.budget ?? null) !== sha256(task?.budget ?? null)) errors.push(`${key}.budget`)
  }
  for (const attempt of attempts) {
    const seen = new Set([attempt.attempt_id])
    let parent = attempt.parent_attempt_id
    while (parent !== undefined) {
      if (!ids.has(parent) || seen.has(parent)) {
        errors.push(`attempts.${attempt.attempt_id}.parent`)
        break
      }
      seen.add(parent)
      parent = ids.get(parent)?.parent_attempt_id
    }
    if (attempt.status === 'running' || attempt.status === 'completed') {
      for (const dependency of tasks.get(attempt.task_id)?.depends_on ?? []) {
        const branches = attempts.filter((item) => item.task_id === dependency)
        if (!branches.length || branches.some((item) => item.status !== 'completed'))
          errors.push(`attempts.${attempt.attempt_id}.dependency.${dependency}`)
      }
    }
  }
  return [...new Set(errors)].sort()
}

export function validateReviewerSnapshot(snapshot: ReviewerSnapshot): readonly string[] {
  const errors: string[] = []
  if (!snapshot || typeof snapshot !== 'object') return ['snapshot.structure']
  const { checksum, ...base } = snapshot
  if (!digest(checksum) || sha256(base) !== checksum) errors.push('snapshot.checksum')
  if (!nonempty(snapshot.snapshot_id) || !digest(snapshot.certificate_checksum))
    errors.push('snapshot.identity')
  if (
    !strings(snapshot.ledger_refs) ||
    snapshot.ledger_refs.some((ref) => !ref.startsWith('ledger:') || !nonempty(ref.slice('ledger:'.length)))
  )
    errors.push('snapshot.ledger_refs')
  const ids = new Set<string>()
  if (!Array.isArray(snapshot.artifacts)) return [...errors, 'snapshot.artifacts']
  for (const artifact of snapshot.artifacts) {
    if (!artifact || typeof artifact !== 'object') {
      errors.push('snapshot.artifacts')
      continue
    }
    const key = `${artifact.id}@${artifact.version}`
    if (!nonempty(artifact.id) || !nonempty(artifact.version) || !digest(artifact.checksum) || ids.has(key))
      errors.push('snapshot.artifacts')
    ids.add(key)
  }
  return [...new Set(errors)].sort()
}
