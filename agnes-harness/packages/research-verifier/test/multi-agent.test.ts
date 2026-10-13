import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  aggregateMultiAgentFindings,
  attemptArtifactRef,
  buildMultiAgentPlan,
  buildMultiAgentResearchManifest,
  createReviewerSnapshot,
  queueAgentAttempt,
  readyMultiAgentTasks,
  runMultiAgentPlan,
  sha256,
  submitAgentFinding,
  type VerificationInput,
  validateAgentAttempts,
  validateMultiAgentPlan,
  validateReviewerSnapshot,
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
    const failed = {
      ...attempt,
      attempt_id: 'failed-1',
      namespace: 'executor/execute/failed-1',
      status: 'failed' as const,
    }
    expect(readyMultiAgentTasks(plan, [failed, { ...attempt, status: 'completed' }])).toEqual([])
    expect(readyMultiAgentTasks(plan, [{ ...attempt, status: 'completed' }, failed])).toEqual([])
    expect(attempt.namespace).not.toBe(
      queueAgentAttempt(plan, 'execute', { attempt_id: 'attempt-2' }).namespace,
    )
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
    expect(result.status).toBe('fail')
    expect(result.validation_errors).toContain('findings.finding-1.snapshot')
    expect(result.report_checksum).toMatch(/^sha256:/)
    expect(aggregateMultiAgentFindings(plan, [], []).status).toBe('unknown')
    expect(aggregateMultiAgentFindings(plan, [attempt], []).status).toBe('unknown')
    const orphan = {
      finding_id: 'orphan',
      attempt_id: 'missing',
      agent_id: 'reviewer',
      status: 'fail' as const,
      message: 'must not be silently dropped',
      evidence_refs: [],
    }
    const rejected = aggregateMultiAgentFindings(plan, [attempt], [orphan])
    expect(rejected.status).toBe('fail')
    expect(rejected.findings).toContainEqual(orphan)
  })

  it('rejects artifacts outside the delegate namespace', () => {
    const attempt = queueAgentAttempt(plan, 'execute', { attempt_id: 'attempt-1' })
    expect(() =>
      attemptArtifactRef(attempt, {
        id: 'reviewer/output',
        version: '1',
        checksum: `sha256:${'0'.repeat(64)}`,
      }),
    ).toThrow(/outside attempt namespace/)
    expect(() =>
      attemptArtifactRef(attempt, {
        id: `${attempt.namespace}/../other`,
        version: '1',
        checksum: sha256('a'),
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
      certificate_checksum: `sha256:${'1'.repeat(64)}`,
      artifacts: [{ id: 'executor/output', version: '1', checksum: `sha256:${'2'.repeat(64)}` }],
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
    expect(() =>
      submitAgentFinding(plan, { ...snapshot, ledger_refs: ['ledger:injected'] }, reviewerAttempt, {
        finding_id: 'forged',
        status: 'pass',
        message: 'tampered',
        evidence_refs: ['ledger:injected'],
      }),
    ).toThrow(/invalid reviewer snapshot/)
    expect(() =>
      submitAgentFinding(
        plan,
        snapshot,
        { ...reviewerAttempt, task_id: 'execute' },
        { finding_id: 'spoofed', status: 'pass', message: 'spoofed task', evidence_refs: ['ledger:event-1'] },
      ),
    ).toThrow(/unknown reviewer attempt/)
    expect(() =>
      submitAgentFinding(plan, snapshot, reviewerAttempt, {
        finding_id: 'empty',
        status: 'pass',
        message: 'no evidence',
        evidence_refs: [],
      }),
    ).toThrow(/requires evidence/)
    expect(() =>
      submitAgentFinding(plan, snapshot, reviewerAttempt, {
        finding_id: 'artifact',
        status: 'warn',
        message: 'outside artifact',
        evidence_refs: [],
        artifact_ids: ['other'],
      }),
    ).toThrow(/outside reviewer snapshot/)
    expect(Object.isFrozen(snapshot.artifacts)).toBe(true)
    expect(validateReviewerSnapshot(snapshot)).toEqual([])
  })

  it('rejects malformed declarations, budgets, overlapping namespaces, cycles and checksum tampering', () => {
    const resign = (patch: object) => {
      const { checksum: _checksum, ...base } = plan
      const changed = { ...base, ...patch }
      return { ...changed, checksum: sha256(changed) }
    }
    for (const patch of [
      { schema_version: 2 },
      { tasks: [] },
      { plan_id: '' },
      { tasks: [{ ...plan.tasks[0], mode: 'invalid' }] },
      { tasks: [{ ...plan.tasks[0], budget: { timeout_ms: -1 } }] },
      { tasks: [{ ...plan.tasks[0], budget: { max_steps: 1.5 } }] },
      { tasks: [{ ...plan.tasks[0], input_artifact_ids: 42 }] },
      { tasks: [{ ...plan.tasks[0], output_namespace: 'executor/../reviewer' }] },
      { tasks: [{ ...plan.tasks[0], depends_on: ['execute'] }] },
      { tasks: [{ ...plan.tasks[0], task_id: 'other' }, plan.tasks[0]] },
      { agents: [{ ...plan.agents[0], role: 'invalid' }, ...plan.agents.slice(1)] },
    ])
      expect(validateMultiAgentPlan(resign(patch)).length).toBeGreaterThan(0)
    expect(validateMultiAgentPlan({ ...plan, run_id: 'tampered' })).toContain('checksum')
    expect(validateMultiAgentPlan(null as never)).toEqual(['plan.structure'])
    expect(() => buildMultiAgentPlan({ ...plan, tasks: [] })).toThrow(/invalid multi-agent plan/)
    expect(Object.isFrozen(plan.tasks)).toBe(true)
    expect(Object.isFrozen(plan.agents[0]?.capabilities)).toBe(true)
  })

  it('validates attempt ownership, duplicate identities, parents and dependency completion', () => {
    const execute = queueAgentAttempt(plan, 'execute', { attempt_id: 'execute-1' })
    const review = queueAgentAttempt(plan, 'review', { attempt_id: 'review-1' })
    for (const attempts of [
      [execute, execute],
      [{ ...execute, agent_id: 'reviewer' }],
      [{ ...execute, namespace: 'executor/execute' }],
      [{ ...execute, output_artifact_ids: ['reviewer/output'] }],
      [{ ...execute, parent_attempt_id: execute.attempt_id }],
      [{ ...execute, parent_attempt_id: 'missing' }],
      [{ ...review, status: 'completed' as const }],
    ])
      expect(validateAgentAttempts(plan, attempts).length).toBeGreaterThan(0)
    expect(
      validateAgentAttempts(plan, [
        { ...execute, status: 'completed' },
        { ...review, status: 'completed', parent_attempt_id: execute.attempt_id },
      ]),
    ).toEqual([])
    const base = {
      run_id: plan.run_id,
      created_at: '2026-10-13T00:00:00Z',
      instance_checksum: sha256('instance'),
    }
    const manifest = buildMultiAgentResearchManifest({ plan, attempts: [execute], artifacts: [], base })
    expect(manifest.activities[0]?.caller?.agent).toBe('executor@r2')
    expect(Object.isFrozen(manifest.activities[0]?.caller)).toBe(true)
    expect(() =>
      buildMultiAgentResearchManifest({
        plan,
        attempts: [execute],
        artifacts: [],
        base: { ...base, run_id: 'other' },
      }),
    ).toThrow(/run_id/)
    expect(() =>
      buildMultiAgentResearchManifest({
        plan,
        attempts: [{ ...execute, output_artifact_ids: [`${execute.namespace}/missing`] }],
        artifacts: [],
        base,
      }),
    ).toThrow(/missing artifact/)
  })

  it('requires harness verification and preserves unknown, failure and snapshot identity', () => {
    const verification = JSON.parse(
      readFileSync(new URL('./fixtures/valid-run.json', import.meta.url), 'utf8'),
    ) as VerificationInput
    const execute = {
      ...queueAgentAttempt(plan, 'execute', { attempt_id: 'execute-1' }),
      status: 'completed' as const,
    }
    const review = {
      ...queueAgentAttempt(plan, 'review', { attempt_id: 'review-1' }),
      status: 'completed' as const,
    }
    const snapshot = createReviewerSnapshot({
      snapshot_id: 's1',
      certificate_checksum: sha256(verification.certificate),
      artifacts: [],
      ledger_refs: ['ledger:start'],
    })
    const finding = submitAgentFinding(plan, snapshot, review, {
      finding_id: 'f1',
      status: 'pass',
      message: 'checked',
      evidence_refs: ['ledger:start'],
    })
    const options = { verification, reviewer_snapshots: [snapshot] }
    const report = aggregateMultiAgentFindings(plan, [execute, review], [finding], options)
    expect(report.status).toBe('pass')
    expect(report.verification?.status).toBe('pass')
    expect(aggregateMultiAgentFindings(plan, [review, execute], [finding], options)).toEqual(report)
    expect(
      aggregateMultiAgentFindings(plan, [execute, review], [finding], { reviewer_snapshots: [snapshot] })
        .status,
    ).toBe('unknown')
    expect(aggregateMultiAgentFindings(plan, [execute, review], [], options).status).toBe('unknown')
    expect(
      aggregateMultiAgentFindings(
        plan,
        [{ ...execute, output_artifact_ids: [`${execute.namespace}/missing`] }, review],
        [finding],
        options,
      ).validation_errors,
    ).toContain('attempts.execute-1.missing_artifact')
    expect(
      aggregateMultiAgentFindings(plan, [execute, review], [{ ...finding, agent_id: 'executor' }], options)
        .status,
    ).toBe('fail')
    expect(aggregateMultiAgentFindings(plan, [execute, review], [finding, finding], options).status).toBe(
      'fail',
    )
    const withoutReplay = structuredClone(verification)
    delete withoutReplay.replay
    expect(
      aggregateMultiAgentFindings(plan, [execute, review], [finding], {
        ...options,
        verification: withoutReplay,
      }).status,
    ).toBe('fail')
    const unknown = submitAgentFinding(plan, snapshot, review, { ...finding, status: 'unknown' })
    expect(aggregateMultiAgentFindings(plan, [execute, review], [unknown], options).status).toBe('unknown')
    const tampered = structuredClone(verification)
    tampered.certificate.witness.result_fields = [{ path: 'table.p_value', value: 99 }]
    expect(
      aggregateMultiAgentFindings(plan, [execute, review], [finding], { ...options, verification: tampered })
        .status,
    ).toBe('fail')
    expect(Object.isFrozen(report.findings)).toBe(true)
  })
})

describe('multi-agent DAG execution', () => {
  const executionPlan = () =>
    buildMultiAgentPlan({
      ...plan,
      tasks: [
        { task_id: 'a', agent_id: 'executor', mode: 'parallel', output_namespace: 'executor/a' },
        { task_id: 'b', agent_id: 'executor', mode: 'parallel', output_namespace: 'executor/b' },
        {
          task_id: 'c',
          agent_id: 'planner',
          mode: 'serial',
          output_namespace: 'planner/c',
          depends_on: ['a', 'b'],
        },
      ],
    })

  it('runs independent work concurrently and waits for dependencies before serial work', async () => {
    const verification = JSON.parse(
      readFileSync(new URL('./fixtures/valid-run.json', import.meta.url), 'utf8'),
    ) as VerificationInput
    for (const task of executionPlan().tasks)
      verification.artifacts.push({
        id: `${task.output_namespace}/attempt-${task.task_id}/result`,
        version: '1',
        checksum: sha256(task.task_id),
      })
    const started: string[] = []
    const releases: Array<() => void> = []
    const running = runMultiAgentPlan({
      plan: executionPlan(),
      verification,
      max_concurrency: 2,
      delegate: async ({ task, attempt, dependencies }) => {
        started.push(task.task_id)
        if (task.task_id !== 'c') await new Promise<void>((resolve) => releases.push(resolve))
        else {
          expect(dependencies.map((item) => item.status)).toEqual(['completed', 'completed'])
          expect(attempt.input_artifact_ids).toEqual(dependencies.flatMap((item) => item.output_artifact_ids))
        }
        return { output_artifact_ids: [`${attempt.namespace}/result`] }
      },
    })
    await Promise.resolve()
    expect(started).toEqual(['a', 'b'])
    for (const release of releases) release()
    const report = await running
    expect(started).toEqual(['a', 'b', 'c'])
    expect(report.status).toBe('pass')
    expect(report.attempts.every((attempt) => attempt.status === 'completed')).toBe(true)
  })

  it('isolates delegate failures, enforces budgets and blocks descendants', async () => {
    const calls: string[] = []
    const report = await runMultiAgentPlan({
      plan: executionPlan(),
      delegate: async ({ task }) => {
        calls.push(task.task_id)
        if (task.task_id === 'a') throw new Error('execution failed')
        return {}
      },
    })
    expect(calls).toEqual(['a', 'b'])
    expect(report.status).toBe('fail')
    expect(report.attempts.map((attempt) => attempt.status)).toEqual(['failed', 'completed', 'blocked'])
    for (const usage of [undefined, { steps: 3 }, { steps: -1 }]) {
      const bounded = buildMultiAgentPlan({
        ...plan,
        tasks: [
          {
            task_id: 'bounded',
            agent_id: 'executor',
            mode: 'serial',
            output_namespace: 'executor/bounded',
            budget: { max_steps: 2 },
          },
        ],
      })
      const result = await runMultiAgentPlan({
        plan: bounded,
        delegate: async () => (usage ? { usage } : {}),
      })
      expect(result.status).toBe('fail')
    }
  })

  it('runs reviewers against frozen evidence and signs only the deterministic result', async () => {
    const verification = JSON.parse(
      readFileSync(new URL('./fixtures/valid-run.json', import.meta.url), 'utf8'),
    ) as VerificationInput
    const snapshot = createReviewerSnapshot({
      snapshot_id: 'review-snapshot',
      certificate_checksum: sha256(verification.certificate),
      artifacts: [],
      ledger_refs: ['ledger:start'],
    })
    const report = await runMultiAgentPlan({
      plan,
      verification,
      delegate: async ({ task, attempt }) => {
        if (task.task_id !== 'review') return {}
        return {
          reviewer_snapshots: [snapshot],
          findings: [
            submitAgentFinding(plan, snapshot, attempt, {
              finding_id: 'review-finding',
              status: 'pass',
              message: 'evidence checked',
              evidence_refs: ['ledger:start'],
            }),
          ],
        }
      },
    })
    expect(report.status).toBe('pass')
    expect(report.issued_by).toBe('harness')
    expect(report.findings[0]?.snapshot_checksum).toBe(snapshot.checksum)
    const snapshotWithMissingLedger = createReviewerSnapshot({ ...snapshot, ledger_refs: ['ledger:missing'] })
    const invalid = submitAgentFinding(
      plan,
      snapshotWithMissingLedger,
      report.attempts.find((attempt) => attempt.task_id === 'review') as NonNullable<
        (typeof report.attempts)[0]
      >,
      { finding_id: 'bad-ledger', status: 'pass', message: 'fabricated', evidence_refs: ['ledger:missing'] },
    )
    expect(
      aggregateMultiAgentFindings(plan, report.attempts, [invalid], {
        verification,
        reviewer_snapshots: [snapshotWithMissingLedger],
      }).status,
    ).toBe('fail')
  })

  it('enforces the concurrency ceiling and serial exclusivity', async () => {
    const independent = buildMultiAgentPlan({
      ...executionPlan(),
      tasks: executionPlan().tasks.map((task) => ({ ...task, depends_on: [] })),
    })
    let active = 0
    let peak = 0
    const report = await runMultiAgentPlan({
      plan: independent,
      max_concurrency: 1,
      delegate: async ({ task }) => {
        active++
        peak = Math.max(peak, active)
        if (task.mode === 'serial') expect(active).toBe(1)
        await Promise.resolve()
        active--
        return {}
      },
    })
    expect(peak).toBe(1)
    expect(report.attempts.every((attempt) => attempt.status === 'completed')).toBe(true)
    expect(report.status).toBe('unknown')
    const first = queueAgentAttempt(independent, 'a', { attempt_id: 'a1' })
    const serial = queueAgentAttempt(independent, 'c', { attempt_id: 'c1' })
    expect(readyMultiAgentTasks(independent, [first]).map((task) => task.task_id)).toEqual(['b'])
    expect(readyMultiAgentTasks(independent, [serial])).toEqual([])
  })

  it('cancels before dispatch and times out delegates without accepting late results', async () => {
    const controller = new AbortController()
    controller.abort()
    let calls = 0
    const cancelled = await runMultiAgentPlan({
      plan: executionPlan(),
      signal: controller.signal,
      delegate: async () => {
        calls++
        return {}
      },
    })
    expect(calls).toBe(0)
    expect(cancelled.status).toBe('unknown')
    expect(cancelled.attempts.every((attempt) => attempt.status === 'cancelled')).toBe(true)
    const timed = buildMultiAgentPlan({
      ...plan,
      tasks: [
        {
          task_id: 'timed',
          agent_id: 'executor',
          mode: 'serial',
          output_namespace: 'executor/timed',
          budget: { timeout_ms: 5 },
        },
      ],
    })
    let signal: AbortSignal | undefined
    const timedOut = await runMultiAgentPlan({
      plan: timed,
      delegate: async (input) => {
        signal = input.signal
        return new Promise(() => {})
      },
    })
    expect(timedOut.status).toBe('fail')
    expect(timedOut.attempts[0]?.error?.code).toBe('TIMEOUT')
    expect(signal?.aborted).toBe(true)
    const midRun = new AbortController()
    const late: Array<(value: object) => void> = []
    const inFlight = runMultiAgentPlan({
      plan: executionPlan(),
      signal: midRun.signal,
      delegate: async () => new Promise((resolve) => late.push(resolve)),
    })
    await Promise.resolve()
    expect(late).toHaveLength(2)
    midRun.abort()
    const interrupted = await inFlight
    expect(interrupted.status).toBe('unknown')
    expect(interrupted.attempts.every((attempt) => attempt.status === 'cancelled')).toBe(true)
    for (const resolve of late) resolve({ output_artifact_ids: ['forged/late-output'] })
    await Promise.resolve()
    expect(interrupted.attempts.every((attempt) => !attempt.output_artifact_ids.length)).toBe(true)
  })
})
