import { type ArtifactRef, type Status, sha256 } from './index.js'
import {
  buildResearchRunManifest,
  type ResearchActivity,
  type ResearchArtifact,
  type ResearchRunManifest,
} from './run.js'

/** Roles are capabilities, not identities. Only the harness may issue a final report. */
export type MultiAgentRole = 'planner' | 'executor' | 'reviewer' | 'verifier'
export type AttemptStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'blocked'
export type TaskMode = 'serial' | 'parallel'

export type AgentDescriptor = Readonly<{
  agent_id: string
  role: MultiAgentRole
  revision: string
  capabilities: readonly string[]
  runtime?: string
  trust?: 'trusted' | 'untrusted'
}>

export type AgentTask = Readonly<{
  task_id: string
  agent_id: string
  mode: TaskMode
  depends_on?: readonly string[]
  input_artifact_ids?: readonly string[]
  output_namespace: string
  budget?: Readonly<{ credits?: number; max_steps?: number; timeout_ms?: number }>
}>

export type MultiAgentPlan = Readonly<{
  schema_version: 1
  plan_id: string
  run_id: string
  root_agent_id: string
  agents: readonly AgentDescriptor[]
  tasks: readonly AgentTask[]
  checksum: string
}>

export type AgentAttempt = Readonly<{
  attempt_id: string
  task_id: string
  agent_id: string
  parent_attempt_id?: string
  namespace: string
  status: AttemptStatus
  input_artifact_ids: readonly string[]
  output_artifact_ids: readonly string[]
  started_at?: string
  ended_at?: string
  budget?: AgentTask['budget']
  error?: Readonly<{ code?: string; message: string }>
}>

export type AgentFinding = Readonly<{
  finding_id: string
  attempt_id: string
  agent_id: string
  status: Status
  message: string
  rule_id?: string
  evidence_refs: readonly string[]
  artifact_ids?: readonly string[]
}>

export type ReviewerSnapshot = Readonly<{
  snapshot_id: string
  certificate_checksum: string
  artifacts: readonly ArtifactRef[]
  ledger_refs: readonly string[]
  checksum: string
}>

export type MultiAgentAggregation = Readonly<{
  schema_version: 1
  plan_checksum: string
  status: Status
  findings: readonly AgentFinding[]
  attempts: readonly AgentAttempt[]
  issued_by: 'harness'
  report_checksum: string
}>

export type MultiAgentState = Readonly<{
  plan: MultiAgentPlan
  attempts: readonly AgentAttempt[]
  findings: readonly AgentFinding[]
}>

const stableCompare = (a: string, b: string): number => a.localeCompare(b)

function sorted<T>(items: readonly T[], key: (item: T) => string): readonly T[] {
  return Object.freeze([...items].sort((a, b) => stableCompare(key(a), key(b))))
}

function unique(items: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(items)].sort(stableCompare))
}

/** Creates a path-free plan. The checksum covers all declarations but not itself. */
export function buildMultiAgentPlan(
  input: Readonly<{
    plan_id: string
    run_id: string
    root_agent_id: string
    agents: readonly AgentDescriptor[]
    tasks: readonly AgentTask[]
  }>,
): MultiAgentPlan {
  const base = {
    schema_version: 1 as const,
    plan_id: input.plan_id,
    run_id: input.run_id,
    root_agent_id: input.root_agent_id,
    agents: sorted(input.agents, (agent) => agent.agent_id).map((agent) => ({
      ...agent,
      capabilities: unique(agent.capabilities),
    })),
    tasks: sorted(input.tasks, (task) => task.task_id).map((task) => ({
      ...task,
      ...(task.depends_on?.length ? { depends_on: unique(task.depends_on) } : {}),
      ...(task.input_artifact_ids?.length ? { input_artifact_ids: unique(task.input_artifact_ids) } : {}),
    })),
  }
  return Object.freeze({ ...base, checksum: sha256(base) })
}

/** Structural and authority checks performed before any delegate can run. */
export function validateMultiAgentPlan(plan: MultiAgentPlan): readonly string[] {
  const errors: string[] = []
  const withoutChecksum = { ...plan }
  delete (withoutChecksum as { checksum?: string }).checksum
  if (sha256(withoutChecksum) !== plan.checksum) errors.push('checksum')
  const agents = new Map(plan.agents.map((agent) => [agent.agent_id, agent]))
  const tasks = new Map(plan.tasks.map((task) => [task.task_id, task]))
  const seenAgents = new Set<string>()
  const seenTasks = new Set<string>()
  for (const agent of plan.agents) {
    if (!agent.agent_id) errors.push('agents.agent_id')
    if (seenAgents.has(agent.agent_id)) errors.push(`agents.${agent.agent_id}.duplicate`)
    seenAgents.add(agent.agent_id)
    if (!agent.revision) errors.push(`agents.${agent.agent_id}.revision`)
  }
  if (!agents.has(plan.root_agent_id)) errors.push('root_agent_id')
  else if (agents.get(plan.root_agent_id)?.role !== 'planner') errors.push('root_agent_id.role')
  for (const task of plan.tasks) {
    if (seenTasks.has(task.task_id)) errors.push(`tasks.${task.task_id}.duplicate`)
    seenTasks.add(task.task_id)
    if (!agents.has(task.agent_id)) errors.push(`tasks.${task.task_id}.agent_id`)
    if (!task.output_namespace || !task.output_namespace.startsWith(`${task.agent_id}/`))
      errors.push(`tasks.${task.task_id}.output_namespace`)
    for (const dependency of task.depends_on ?? []) {
      if (!tasks.has(dependency)) errors.push(`tasks.${task.task_id}.depends_on.${dependency}`)
      if (dependency === task.task_id) errors.push(`tasks.${task.task_id}.cycle`)
    }
  }
  // Kahn's algorithm gives a deterministic cycle check without running delegates.
  const remaining = new Map<string, number>(
    plan.tasks.map((task) => [task.task_id, (task.depends_on ?? []).filter((id) => tasks.has(id)).length]),
  )
  const queue = [...remaining.entries()]
    .filter(([, count]) => count === 0)
    .map(([id]) => id)
    .sort(stableCompare)
  let visited = 0
  while (queue.length) {
    const id = queue.shift() as string
    visited += 1
    for (const task of plan.tasks) {
      if (!(task.depends_on ?? []).includes(id)) continue
      const next = (remaining.get(task.task_id) ?? 0) - 1
      remaining.set(task.task_id, next)
      if (next === 0) queue.push(task.task_id)
    }
    queue.sort(stableCompare)
  }
  if (visited !== plan.tasks.length) errors.push('tasks.cycle')
  return Object.freeze([...new Set(errors)].sort(stableCompare))
}

/** Returns the next runnable tasks in stable order; failed dependencies block their descendants. */
export function readyMultiAgentTasks(
  plan: MultiAgentPlan,
  attempts: readonly AgentAttempt[],
): readonly AgentTask[] {
  const terminal = new Map<string, AttemptStatus>()
  for (const attempt of attempts) terminal.set(attempt.task_id, attempt.status)
  return Object.freeze(
    plan.tasks
      .filter((task) => !terminal.has(task.task_id))
      .filter((task) => (task.depends_on ?? []).every((id) => terminal.get(id) === 'completed'))
      .sort((a, b) => stableCompare(a.task_id, b.task_id)),
  )
}

/** Creates an immutable queued attempt with an agent-owned artifact namespace. */
export function queueAgentAttempt(
  plan: MultiAgentPlan,
  taskId: string,
  input: Readonly<{ attempt_id: string; parent_attempt_id?: string }>,
): AgentAttempt {
  const task = plan.tasks.find((candidate) => candidate.task_id === taskId)
  if (!task) throw new Error(`unknown task: ${taskId}`)
  if (validateMultiAgentPlan(plan).length) throw new Error('invalid multi-agent plan')
  return Object.freeze({
    attempt_id: input.attempt_id,
    task_id: task.task_id,
    agent_id: task.agent_id,
    ...(input.parent_attempt_id ? { parent_attempt_id: input.parent_attempt_id } : {}),
    namespace: task.output_namespace,
    status: 'queued',
    input_artifact_ids: Object.freeze([...(task.input_artifact_ids ?? [])]),
    output_artifact_ids: Object.freeze([]),
    ...(task.budget ? { budget: task.budget } : {}),
  })
}

/** Freezes the evidence a reviewer may inspect. No workspace path or mutable object is retained. */
export function createReviewerSnapshot(
  input: Readonly<{
    snapshot_id: string
    certificate_checksum: string
    artifacts: readonly ArtifactRef[]
    ledger_refs: readonly string[]
  }>,
): ReviewerSnapshot {
  const base = {
    snapshot_id: input.snapshot_id,
    certificate_checksum: input.certificate_checksum,
    artifacts: sorted(input.artifacts, (artifact) => `${artifact.id}@${artifact.version}`).map((artifact) =>
      Object.freeze({ ...artifact }),
    ),
    ledger_refs: unique(input.ledger_refs),
  }
  return Object.freeze({ ...base, checksum: sha256(base) })
}

/** Accepts a finding only from a reviewer attempt and only for frozen evidence. */
export function submitAgentFinding(
  plan: MultiAgentPlan,
  snapshot: ReviewerSnapshot,
  attempt: AgentAttempt,
  input: Readonly<Omit<AgentFinding, 'attempt_id' | 'agent_id'>>,
): AgentFinding {
  const descriptor = plan.agents.find((agent) => agent.agent_id === attempt.agent_id)
  if (!descriptor || descriptor.role !== 'reviewer') throw new Error('attempt is not a reviewer')
  if (attempt.status !== 'running' && attempt.status !== 'completed')
    throw new Error('reviewer attempt is not active')
  if (!attempt.attempt_id || !plan.tasks.some((task) => task.task_id === attempt.task_id))
    throw new Error('unknown reviewer attempt')
  const allowed = new Set([
    ...snapshot.ledger_refs,
    ...snapshot.artifacts.map((artifact) => `artifact:${artifact.id}@${artifact.version}`),
  ])
  if (input.evidence_refs.some((ref) => !allowed.has(ref)))
    throw new Error('finding references evidence outside reviewer snapshot')
  return Object.freeze({
    ...input,
    attempt_id: attempt.attempt_id,
    agent_id: attempt.agent_id,
    evidence_refs: unique(input.evidence_refs),
    ...(input.artifact_ids ? { artifact_ids: unique(input.artifact_ids) } : {}),
  })
}

/** Agent findings are evidence only. This function is the sole final-status authority. */
export function aggregateMultiAgentFindings(
  plan: MultiAgentPlan,
  attempts: readonly AgentAttempt[],
  findings: readonly AgentFinding[],
): MultiAgentAggregation {
  const planErrors = validateMultiAgentPlan(plan)
  const attemptIds = new Set(attempts.map((attempt) => attempt.attempt_id))
  const validFindings = findings.filter((finding) => attemptIds.has(finding.attempt_id))
  const orderedAttempts = sorted(attempts, (attempt) => attempt.attempt_id)
  const orderedFindings = sorted(validFindings, (finding) => finding.finding_id)
  const status: Status = planErrors.length
    ? 'fail'
    : orderedAttempts.some((attempt) => attempt.status === 'failed' || attempt.status === 'blocked')
      ? 'fail'
      : orderedFindings.some((finding) => finding.status === 'fail')
        ? 'fail'
        : orderedFindings.some((finding) => finding.status === 'unknown')
          ? 'unknown'
          : orderedFindings.some((finding) => finding.status === 'warn')
            ? 'warn'
            : orderedAttempts.some((attempt) => attempt.status !== 'completed')
              ? 'unknown'
              : 'pass'
  const base = {
    schema_version: 1 as const,
    plan_checksum: plan.checksum,
    status,
    findings: orderedFindings,
    attempts: orderedAttempts,
    issued_by: 'harness' as const,
  }
  return Object.freeze({ ...base, report_checksum: sha256(base) })
}

/** Converts delegate attempts/findings into the existing research activity sidecar. */
export function multiAgentActivities(
  plan: MultiAgentPlan,
  attempts: readonly AgentAttempt[],
): readonly ResearchActivity[] {
  const descriptors = new Map(plan.agents.map((agent) => [agent.agent_id, agent]))
  return Object.freeze(
    sorted(attempts, (attempt) => attempt.attempt_id).map((attempt) => {
      const agent = descriptors.get(attempt.agent_id)
      const task = plan.tasks.find((candidate) => candidate.task_id === attempt.task_id)
      const status =
        attempt.status === 'completed'
          ? ('recorded' as const)
          : attempt.status === 'failed' || attempt.status === 'blocked' || attempt.status === 'cancelled'
            ? ('failed' as const)
            : ('unknown' as const)
      return {
        activity_id: `agent:${attempt.attempt_id}`,
        ...(attempt.parent_attempt_id ? { parent_id: `agent:${attempt.parent_attempt_id}` } : {}),
        kind: task?.agent_id === plan.root_agent_id ? ('plan' as const) : ('run' as const),
        status,
        started_at: attempt.started_at ?? '',
        ...(attempt.ended_at ? { ended_at: attempt.ended_at } : {}),
        caller: { agent: `${attempt.agent_id}@${agent?.revision ?? 'unknown'}` },
        ...(attempt.input_artifact_ids.length ? { input_artifact_ids: attempt.input_artifact_ids } : {}),
        ...(attempt.output_artifact_ids.length ? { output_artifact_ids: attempt.output_artifact_ids } : {}),
        ...(attempt.error ? { error: attempt.error } : {}),
      }
    }),
  )
}

/** Adds multi-agent activities and plan artifacts to a normal research manifest. */
export function buildMultiAgentResearchManifest(
  input: Readonly<{
    plan: MultiAgentPlan
    attempts: readonly AgentAttempt[]
    artifacts: readonly ResearchArtifact[]
    base: Omit<Parameters<typeof buildResearchRunManifest>[0], 'activities' | 'artifacts'>
  }>,
): ResearchRunManifest {
  const planArtifact: ResearchArtifact = {
    id: `plan:${input.plan.plan_id}`,
    version: input.plan.checksum,
    checksum: input.plan.checksum,
    kind: 'multi-agent-plan',
    role: 'source',
    content_type: 'application/json',
  }
  return buildResearchRunManifest({
    ...input.base,
    activities: multiAgentActivities(input.plan, input.attempts),
    artifacts: [...input.artifacts, planArtifact] as readonly ResearchArtifact[],
  })
}

/** Narrows a generic artifact reference to an attempt-owned namespace. */
export function attemptArtifactRef(attempt: AgentAttempt, artifact: ArtifactRef): ArtifactRef {
  if (!artifact.id.startsWith(`${attempt.namespace}/`))
    throw new Error(`artifact ${artifact.id} is outside attempt namespace ${attempt.namespace}`)
  return Object.freeze({ ...artifact })
}
