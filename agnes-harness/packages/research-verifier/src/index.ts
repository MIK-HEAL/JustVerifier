import { createHash } from 'node:crypto'

export const SCHEMA_VERSION = 1 as const
export const RULESET_VERSION = 'research-verifier-p0@1' as const
export type Status = 'pass' | 'warn' | 'fail' | 'unknown'
export type AssumptionStatus = 'satisfied' | 'violated' | 'unknown' | 'not-applicable'
export type EvidenceCoverage = 'available' | 'partial' | 'unavailable'

export interface ArtifactRef {
  id: string
  version: string
  checksum: string
  kind?: string
}
export interface Claim {
  id: string
  text: string
  kind: string
  scope?: Record<string, unknown>
}
export interface Instance {
  dataset_version_id: string
  dataset_checksum: string
  analysis_spec_checksum: string
  assumption_ids: string[]
}
export interface ResultField {
  path: string
  value: unknown
}
export interface Witness {
  source_code_version_id: string
  execution_id: string
  input_version_ids: string[]
  output_version_ids: string[]
  environment_fingerprint: string
  result_fields: ResultField[]
}
export interface EvidenceRef {
  kind: 'ledger-event' | 'artifact-version' | 'receipt'
  ref: string
  checksum: string
  coverage?: EvidenceCoverage
}
export interface Assumption {
  id: string
  statement: string
  required_for: string[]
  observable_checks: string[]
  status: AssumptionStatus
  evidence_refs: string[]
  unknown_reason?: string
  severity?: 'warning' | 'error'
}
export interface SkillProvenance {
  id: string
  version: string
  source: string
  trust: 'trusted' | 'untrusted'
}
export interface Certificate {
  schema_version: 1
  claim: Claim
  instance: Instance
  witness: Witness
  evidence: EvidenceRef[]
  assumptions?: Assumption[]
  skills?: SkillProvenance[]
  ruleset_checksum?: string
}
export interface LedgerEvent {
  id: string
  seq: number
  type: string
  data?: Record<string, unknown>
  checksum?: string
}
export interface Artifact extends ArtifactRef {
  payload?: unknown
  result_fields?: ResultField[]
}
export interface ReplayResult {
  execution_id: string
  result_fields: ResultField[]
  deterministic?: boolean
}
export interface VerificationInput {
  certificate: Certificate
  artifacts: Artifact[]
  ledger: LedgerEvent[]
  replay?: ReplayResult
  ruleset?: Ruleset
}
export interface RuleResult {
  rule_id: string
  status: Status
  message: string
  evidence_refs: string[]
  observed: unknown
  expected: unknown
  blocking: boolean
}
export interface Ruleset {
  version: string
  checksum: string
  assumption_policy?: 'warn' | 'fail'
}
export interface VerificationReport {
  schema_version: 1
  ruleset: Ruleset
  status: Status
  results: RuleResult[]
  summary: string
  report_checksum: string
}

const stable = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
    .join(',')}}`
}
export const sha256 = (value: unknown): string =>
  `sha256:${createHash('sha256').update(stable(value)).digest('hex')}`
export const DEFAULT_RULESET: Ruleset = {
  version: RULESET_VERSION,
  checksum: sha256({
    version: RULESET_VERSION,
    rules: [
      'instance-integrity',
      'witness-completeness',
      'ledger-binding',
      'output-binding',
      'replay-consistency',
      'assumption-status',
      'evidence-coverage',
      'claim-scope',
    ],
  }),
}
const result = (
  rule_id: string,
  status: Status,
  message: string,
  evidence_refs: string[],
  observed: unknown,
  expected: unknown,
  blocking = status === 'fail',
): RuleResult => ({
  rule_id,
  status,
  message,
  evidence_refs: [...evidence_refs].sort(),
  observed,
  expected,
  blocking,
})
const sameFields = (a: ResultField[], b: ResultField[]) =>
  stable([...a].sort((x, y) => x.path.localeCompare(y.path))) ===
  stable([...b].sort((x, y) => x.path.localeCompare(y.path)))

export function verifyCertificate(input: VerificationInput): VerificationReport {
  const c = input.certificate
  const find = (id: string) => input.artifacts.find((a) => a.id === id || `${a.id}@${a.version}` === id)
  const ruleset = input.ruleset ?? DEFAULT_RULESET
  const results: RuleResult[] = []
  const dataset = find(c.instance.dataset_version_id)
  results.push(
    dataset && dataset.checksum === c.instance.dataset_checksum
      ? result(
          'instance-integrity',
          'pass',
          'Dataset version and checksum match.',
          [c.instance.dataset_version_id],
          dataset.checksum,
          c.instance.dataset_checksum,
        )
      : result(
          'instance-integrity',
          'fail',
          'Dataset version is missing or checksum does not match.',
          [c.instance.dataset_version_id],
          dataset?.checksum ?? null,
          c.instance.dataset_checksum,
        ),
  )
  const complete =
    !!c.witness.source_code_version_id &&
    !!c.witness.execution_id &&
    c.witness.input_version_ids.length > 0 &&
    c.witness.output_version_ids.length > 0 &&
    !!c.witness.environment_fingerprint
  results.push(
    result(
      'witness-completeness',
      complete ? 'pass' : 'fail',
      complete ? 'Witness contains all required identity fields.' : 'Witness is missing a required field.',
      [],
      {
        source: !!c.witness.source_code_version_id,
        execution: !!c.witness.execution_id,
        inputs: c.witness.input_version_ids.length,
        outputs: c.witness.output_version_ids.length,
        environment: !!c.witness.environment_fingerprint,
      },
      'source, execution, input, output and environment',
    ),
  )
  const executionEvents = input.ledger
    .filter(
      (e) =>
        e.data?.execution_id === c.witness.execution_id || e.data?.executionId === c.witness.execution_id,
    )
    .sort((a, b) => a.seq - b.seq || a.id.localeCompare(b.id))
  const types = new Set(executionEvents.map((e) => e.type))
  const start = executionEvents.findIndex((event) => event.type === 'step/start')
  const tool = executionEvents.findIndex((event) => event.type === 'tool/result')
  const end = executionEvents.findIndex((event) => event.type === 'step/end')
  const ledgerOk = start >= 0 && tool > start && end > tool
  results.push(
    result(
      'ledger-binding',
      ledgerOk ? 'pass' : 'fail',
      ledgerOk
        ? 'Execution is bound to start, tool result and end events.'
        : 'Execution is not fully bound to ledger events.',
      executionEvents.map((e) => e.id),
      [...types].sort(),
      ['step/start', 'tool/result', 'step/end'],
    ),
  )
  const output = c.witness.output_version_ids.map((id) => find(id)).filter((a): a is Artifact => !!a)
  const actualFields = output.flatMap(
    (a) => a.result_fields ?? (Array.isArray(a.payload) ? (a.payload as ResultField[]) : []),
  )
  const outputOk =
    output.length === c.witness.output_version_ids.length && sameFields(actualFields, c.witness.result_fields)
  results.push(
    result(
      'output-binding',
      outputOk ? 'pass' : 'fail',
      outputOk
        ? 'Certificate fields match execution output.'
        : 'Certificate fields differ from execution output or output is missing.',
      c.witness.output_version_ids,
      c.witness.result_fields,
      actualFields,
    ),
  )
  const replayOk =
    !!input.replay &&
    input.replay.execution_id === c.witness.execution_id &&
    sameFields(input.replay.result_fields, c.witness.result_fields) &&
    input.replay.deterministic !== false
  results.push(
    result(
      'replay-consistency',
      replayOk ? 'pass' : 'fail',
      replayOk ? 'Replay produced the same result.' : 'Replay is missing or produced a different result.',
      [c.witness.execution_id],
      input.replay?.result_fields ?? null,
      c.witness.result_fields,
    ),
  )
  const assumptions = c.assumptions ?? []
  const missing = c.instance.assumption_ids.filter((id) => !assumptions.some((a) => a.id === id))
  const violated = assumptions.filter(
    (a) => c.instance.assumption_ids.includes(a.id) && a.status === 'violated',
  )
  const unknown = assumptions.filter(
    (a) => c.instance.assumption_ids.includes(a.id) && a.status === 'unknown',
  )
  const assumptionStatus: Status = violated.length
    ? ruleset.assumption_policy === 'warn'
      ? 'warn'
      : 'fail'
    : missing.length || unknown.length
      ? 'unknown'
      : 'pass'
  results.push(
    result(
      'assumption-status',
      assumptionStatus,
      violated.length
        ? 'A required assumption is violated.'
        : missing.length
          ? 'A required assumption has no diagnostic.'
          : unknown.length
            ? 'A required assumption is unknown.'
            : 'All required assumptions are satisfied.',
      assumptions.flatMap((a) => a.evidence_refs),
      { missing, violated: violated.map((a) => a.id), unknown: unknown.map((a) => a.id) },
      'required assumptions satisfied',
      assumptionStatus === 'fail',
    ),
  )
  const missingEvidence = c.evidence.filter((evidence) => {
    if (evidence.kind === 'artifact-version' && evidence.ref.startsWith('artifact:')) {
      return !find(evidence.ref.slice('artifact:'.length))
    }
    if (evidence.kind === 'ledger-event' && evidence.ref.startsWith('ledger:')) {
      return !input.ledger.some((event) => event.id === evidence.ref.slice('ledger:'.length))
    }
    return false
  })
  const unavailable = c.evidence.filter((e) => e.coverage === 'unavailable')
  const partial = c.evidence.filter((e) => e.coverage === 'partial')
  const evidenceStatus: Status = missingEvidence.length
    ? 'fail'
    : unavailable.length || partial.length
      ? 'warn'
      : c.evidence.length
        ? 'pass'
        : 'unknown'
  results.push(
    result(
      'evidence-coverage',
      evidenceStatus,
      missingEvidence.length
        ? 'An evidence reference does not resolve to an immutable artifact or ledger event.'
        : unavailable.length
          ? 'Evidence is unavailable.'
          : partial.length
            ? 'Evidence is partial.'
            : c.evidence.length
              ? 'Evidence references are available.'
              : 'No evidence references supplied.',
      c.evidence.map((e) => e.ref),
      {
        missing: missingEvidence.map((e) => e.ref),
        unavailable: unavailable.length,
        partial: partial.length,
      },
      'all evidence available',
      evidenceStatus === 'fail',
    ),
  )
  const scoped = !!c.claim.scope && Object.keys(c.claim.scope).length > 0
  results.push(
    result(
      'claim-scope',
      scoped ? 'pass' : 'warn',
      scoped
        ? 'Claim declares an explicit evidence scope.'
        : 'Claim scope is conservatively unverified by the MVP.',
      [],
      c.claim.scope ?? null,
      'explicit scope checks',
      false,
    ),
  )
  const hasFail = results.some((r) => r.status === 'fail' && r.blocking)
  const hasWarn = results.some((r) => r.status === 'warn' || r.status === 'unknown')
  const status: Status = hasFail
    ? 'fail'
    : hasWarn
      ? results.some((r) => r.status === 'unknown')
        ? 'unknown'
        : 'warn'
      : 'pass'
  const reportBase = {
    schema_version: SCHEMA_VERSION,
    ruleset,
    status,
    results,
    summary: `${status}: ${results.filter((r) => r.status === 'pass').length} pass, ${results.filter((r) => r.status === 'warn').length} warn, ${results.filter((r) => r.status === 'unknown').length} unknown, ${results.filter((r) => r.status === 'fail').length} fail`,
  }
  return { ...reportBase, report_checksum: sha256(reportBase) }
}
export const verificationExitCode = (status: Status): number =>
  status === 'pass' ? 0 : status === 'warn' ? 2 : status === 'unknown' ? 3 : 1

export type { ExecutionManifest, ResearchRunSnapshot } from './manifest.js'
export { buildExecutionManifest, manifestEvidenceRefs } from './manifest.js'
export type { EvidenceGraph, EvidenceGraphEdge, EvidenceGraphNode } from './projection.js'
export { projectEvidenceGraph } from './projection.js'
