import { describe, expect, it } from 'vitest'
import {
  aggregateMultiAgentFindings,
  attemptArtifactRef,
  buildMultiAgentPlan,
  createReviewerSnapshot,
  queueAgentAttempt,
  readyMultiAgentTasks,
  submitAgentFinding,
  validateMultiAgentPlan,
} from '../src/index.js'

const plan = buildMultiAgentPlan({
  plan_id: 'plan-1',
  run_id: 'run-1',
  root_agent_id: 'planner',
  agents: [
    { agent_id: 'planner', role: 'planner', revision: 'r1', capabilities: ['plan'] },
    { agent_id: 'executor', role: 'executor', revision: 'r2', capabilities: ['run'] },
    { agent_id: 'reviewer', role: 'reviewer', revision: 'r3', capabilities: ['review'] },
  ],
  tasks: [
    { task_id: 'execute', agent_id: 'executor', mode: 'parallel', output_namespace: 'executor/execute' },
    {
      task_id: 'review',
      agent_id: 'reviewer',
      mode: 'serial',
      depends_on: ['execute'],
      output_namespace: 'reviewer/review',
    },
  ],
})

describe('multi-agent research contract', () => {
  it('normalizes and validates a deterministic dependency plan', () => {
    expect(validateMultiAgentPlan(plan)).toEqual([])
    expect(readyMultiAgentTasks(plan, []).map((task) => task.task_id)).toEqual(['execute'])
    const attempt = queueAgentAttempt(plan, 'execute', { attempt_id: 'attempt-1' })
    expect(readyMultiAgentTasks(plan, [attempt])).toEqual([])
    expect(
      readyMultiAgentTasks(plan, [{ ...attempt, status: 'completed' }]).map((task) => task.task_id),
    ).toEqual(['review'])
  })

  it('keeps findings advisory and signs the aggregate as the harness', () => {
    const attempt = {
      ...queueAgentAttempt(plan, 'execute', { attempt_id: 'attempt-1' }),
      status: 'completed' as const,
    }
    const result = aggregateMultiAgentFindings(
      plan,
      [attempt],
      [
        {
          finding_id: 'finding-1',
          attempt_id: attempt.attempt_id,
          agent_id: attempt.agent_id,
          status: 'warn',
          message: 'review required',
          evidence_refs: ['artifact:executor/output@1'],
        },
      ],
    )
    expect(result.issued_by).toBe('harness')
    expect(result.status).toBe('warn')
    expect(result.report_checksum).toMatch(/^sha256:/)
  })

  it('rejects artifacts outside the delegate namespace', () => {
    const attempt = queueAgentAttempt(plan, 'execute', { attempt_id: 'attempt-1' })
    expect(() =>
      attemptArtifactRef(attempt, {
        id: 'reviewer/output',
        version: '1',
        checksum: 'sha256:' + '0'.repeat(64),
      }),
    ).toThrow(/outside attempt namespace/)
  })

  it('limits reviewer findings to a frozen evidence snapshot', () => {
    const reviewerAttempt = {
      ...queueAgentAttempt(plan, 'review', { attempt_id: 'review-1' }),
      status: 'running' as const,
    }
    const snapshot = createReviewerSnapshot({
      snapshot_id: 'snapshot-1',
      certificate_checksum: 'sha256:' + '1'.repeat(64),
      artifacts: [{ id: 'executor/output', version: '1', checksum: 'sha256:' + '2'.repeat(64) }],
      ledger_refs: ['ledger:event-1'],
    })
    expect(
      submitAgentFinding(plan, snapshot, reviewerAttempt, {
        finding_id: 'finding-2',
        status: 'pass',
        message: 'evidence is consistent',
        evidence_refs: ['artifact:executor/output@1'],
      }).agent_id,
    ).toBe('reviewer')
    expect(() =>
      submitAgentFinding(plan, snapshot, reviewerAttempt, {
        finding_id: 'finding-3',
        status: 'pass',
        message: 'outside snapshot',
        evidence_refs: ['ledger:event-2'],
      }),
    ).toThrow(/outside reviewer snapshot/)
  })
})
