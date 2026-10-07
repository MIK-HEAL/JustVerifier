import { type ArtifactRef, type Certificate, type LedgerEvent, type Status, sha256 } from './index.js'

/** Evidence states are deliberately fail closed: only `verified` can support a verified claim. */
export type ResearchEvidenceStatus = 'recorded' | 'verified' | 'partial' | 'unknown' | 'failed'
export type ResearchActivityKind = 'run' | 'plan' | 'skill' | 'tool' | 'approval' | 'verification' | 'replay'
export type ReplayState = 'available' | 'verified' | 'unavailable' | 'failed' | 'non-deterministic'

export type ResearchCaller = Readonly<{
  agent?: string
  skill?: string
  mcp?: Readonly<{ server_id: string; revision: string; tool_name: string; schema_checksum: string }>
}>

export type ResearchActivity = Readonly<{
  activity_id: string
  parent_id?: string
  kind: ResearchActivityKind
  status: ResearchEvidenceStatus
  started_at: string
  ended_at?: string
  caller?: ResearchCaller
  parameter_summary?: string
  approval?: 'not-required' | 'pending' | 'approved' | 'rejected'
  input_artifact_ids?: readonly string[]
  output_artifact_ids?: readonly string[]
  assumption_ids?: readonly string[]
  verification_rule_ids?: readonly string[]
  replay?: ReplayState
  ledger_seqs?: readonly number[]
  error?: Readonly<{ code?: string; message?: string }>
}>

export type ResearchArtifact = Readonly<
  ArtifactRef & {
    role: 'input' | 'output' | 'source' | 'receipt' | 'environment' | 'certificate'
    content_type?: string
    size?: number
  }
>

export type ResearchAssumption = Readonly<{
  id: string
  status: 'satisfied' | 'violated' | 'unknown' | 'not-applicable'
  evidence_refs: readonly string[]
  unknown_reason?: string
}>

export type ResearchRunManifest = Readonly<{
  run_id: string
  schema_version: 1
  created_at: string
  instance_checksum: string
  certificate_checksum?: string
  ruleset_checksum?: string
  agent_model_id?: string
  agent_runtime_version?: string
  skill_refs: readonly Readonly<{
    name: string
    revision: string
    source: string
    trust: string
    actual: string
  }>[]
  mcp_refs: readonly Readonly<{
    server_id: string
    revision: string
    tool_name: string
    schema_checksum: string
    policy?: string
  }>[]
  activities: readonly ResearchActivity[]
  artifacts: readonly ResearchArtifact[]
  assumptions: readonly ResearchAssumption[]
  ledger: Readonly<{ session: string; first_seq?: number; last_seq?: number; digest?: string }>
  environment: Readonly<{
    os?: string
    arch?: string
    runtime?: string
    packages_digest?: string
    tool_versions?: readonly string[]
  }>
  replay: Readonly<{
    recipe_id: string
    input_refs: readonly string[]
    command_refs: readonly string[]
    deterministic: boolean
    state: ReplayState
  }>
  checksum: string
}>

export type ResearchEventType =
  | 'research/run-started'
  | 'research/activity'
  | 'research/assumption'
  | 'research/evidence'
  | 'research/run-finalized'

export type ResearchEventPayload = Readonly<{
  run_id: string
  activity?: ResearchActivity
  assumption?: ResearchAssumption
  evidence?: Readonly<{ artifact_id: string; status: ResearchEvidenceStatus; receipt_ref?: string }>
  manifest_checksum?: string
}>

export type ResearchEvent = Readonly<
  Omit<LedgerEvent, 'type' | 'data'> & {
    type: ResearchEventType
    data: ResearchEventPayload
  }
>

const byStableId = <T extends { activity_id?: string; id?: string; name?: string }>(a: T, b: T): number =>
  (a.activity_id ?? a.id ?? a.name ?? '').localeCompare(b.activity_id ?? b.id ?? b.name ?? '')

const sorted = <T>(items: readonly T[], compare: (a: T, b: T) => number): readonly T[] =>
  Object.freeze([...items].sort(compare).map((item) => item))

/** Build a path-free manifest. The checksum excludes itself and is stable across input ordering. */
export function buildResearchRunManifest(
  input: Readonly<{
    run_id: string
    created_at: string
    instance_checksum: string
    certificate?: Certificate
    agent_model_id?: string
    agent_runtime_version?: string
    skill_refs?: ResearchRunManifest['skill_refs']
    mcp_refs?: ResearchRunManifest['mcp_refs']
    activities: readonly ResearchActivity[]
    artifacts: readonly ResearchArtifact[]
    assumptions?: readonly ResearchAssumption[]
    ledger?: ResearchRunManifest['ledger']
    environment?: ResearchRunManifest['environment']
    replay?: ResearchRunManifest['replay']
  }>,
): ResearchRunManifest {
  const base = {
    run_id: input.run_id,
    schema_version: 1 as const,
    created_at: input.created_at,
    instance_checksum: input.instance_checksum,
    ...(input.certificate ? { certificate_checksum: sha256(input.certificate) } : {}),
    ...(input.certificate?.ruleset_checksum ? { ruleset_checksum: input.certificate.ruleset_checksum } : {}),
    ...(input.agent_model_id ? { agent_model_id: input.agent_model_id } : {}),
    ...(input.agent_runtime_version ? { agent_runtime_version: input.agent_runtime_version } : {}),
    skill_refs: sorted(input.skill_refs ?? [], byStableId),
    mcp_refs: sorted(input.mcp_refs ?? [], (a, b) =>
      `${a.server_id}/${a.tool_name}`.localeCompare(`${b.server_id}/${b.tool_name}`),
    ),
    activities: sorted(input.activities, byStableId),
    artifacts: sorted(input.artifacts, (a, b) =>
      `${a.id}@${a.version}`.localeCompare(`${b.id}@${b.version}`),
    ),
    assumptions: sorted(input.assumptions ?? [], (a, b) => a.id.localeCompare(b.id)),
    ledger: input.ledger ?? { session: input.run_id },
    environment: input.environment ?? {},
    replay: input.replay ?? {
      recipe_id: `${input.run_id}:replay`,
      input_refs: [],
      command_refs: [],
      deterministic: false,
      state: 'unavailable' as const,
    },
  }
  return Object.freeze({ ...base, checksum: sha256(base) })
}

export function researchEvent(
  type: ResearchEventType,
  seq: number,
  id: string,
  ts: string,
  data: ResearchEventPayload,
): ResearchEvent {
  return Object.freeze({ seq, id, ts, type, data })
}

export type ResearchRunPackage = Readonly<{
  manifest: ResearchRunManifest
  files: Readonly<Record<string, string>>
  checksums: Readonly<Record<string, string>>
}>

/** Creates an offline package. All bytes are supplied by the caller; no filesystem or network access occurs. */
export function exportResearchRunPackage(
  input: Readonly<{
    manifest: ResearchRunManifest
    ledger: readonly LedgerEvent[]
    certificate?: Certificate
    ruleset?: unknown
    environment?: unknown
    artifacts?: Readonly<Record<string, string>>
  }>,
): ResearchRunPackage {
  const files: Record<string, string> = {
    'run-manifest.json': JSON.stringify(input.manifest),
    'ledger.jsonl': input.ledger.map((event) => JSON.stringify(event)).join('\n'),
    ...(input.certificate ? { 'certificate.json': JSON.stringify(input.certificate) } : {}),
    ...(input.ruleset ? { 'ruleset.json': JSON.stringify(input.ruleset) } : {}),
    ...(input.environment ? { 'environment.json': JSON.stringify(input.environment) } : {}),
    ...(input.artifacts
      ? Object.fromEntries(
          Object.entries(input.artifacts).map(([name, value]) => [`artifacts/${name}`, value]),
        )
      : {}),
    README: 'This package is self-contained. Replay must not access the network or current workspace.\n',
  }
  const checksums = Object.freeze(
    Object.fromEntries(Object.entries(files).map(([name, value]) => [name, sha256(value)])),
  )
  files['checksums.json'] = JSON.stringify(checksums)
  return Object.freeze({ manifest: input.manifest, files: Object.freeze(files), checksums })
}

export type PackageCheck = Readonly<{ ok: boolean; file?: string; message: string }>

export function verifyResearchRunPackage(pkg: ResearchRunPackage): readonly PackageCheck[] {
  const checks: PackageCheck[] = []
  const manifestWithoutChecksum = { ...pkg.manifest }
  delete (manifestWithoutChecksum as { checksum?: string }).checksum
  checks.push({
    ok: sha256(manifestWithoutChecksum) === pkg.manifest.checksum,
    file: 'run-manifest.json',
    message: 'manifest checksum',
  })
  for (const [name, expected] of Object.entries(pkg.checksums)) {
    const actual = pkg.files[name]
    checks.push({
      ok: actual !== undefined && sha256(actual) === expected,
      file: name,
      message: actual === undefined ? 'missing file' : 'file checksum',
    })
  }
  const checksumIndex = pkg.files['checksums.json']
  let checksumIndexOk = false
  if (checksumIndex !== undefined) {
    try {
      checksumIndexOk = sha256(JSON.parse(checksumIndex)) === sha256(pkg.checksums)
    } catch {
      checksumIndexOk = false
    }
  }
  checks.push({
    ok: checksumIndexOk,
    file: 'checksums.json',
    message: checksumIndex === undefined ? 'checksum index missing' : 'checksum index matches',
  })
  return Object.freeze(checks)
}

/** Structural checks used before replay. Missing terminal activity or parent references are errors. */
export function validateResearchRunManifest(manifest: ResearchRunManifest): readonly string[] {
  const errors: string[] = []
  const ids = new Set(manifest.activities.map((activity) => activity.activity_id))
  for (const activity of manifest.activities) {
    if (activity.parent_id && !ids.has(activity.parent_id))
      errors.push(`activities.${activity.activity_id}.parent_id`)
    if (!activity.started_at) errors.push(`activities.${activity.activity_id}.started_at`)
    if (activity.status !== 'recorded' && !activity.ended_at)
      errors.push(`activities.${activity.activity_id}.ended_at`)
    if (activity.kind === 'tool' && activity.caller?.mcp && !activity.caller.mcp.schema_checksum)
      errors.push(`activities.${activity.activity_id}.caller.mcp.schema_checksum`)
    if (activity.status === 'verified' && activity.replay && activity.replay !== 'verified')
      errors.push(`activities.${activity.activity_id}.replay`)
  }
  const artifactIds = new Set(manifest.artifacts.map((artifact) => `${artifact.id}@${artifact.version}`))
  for (const activity of manifest.activities) {
    for (const ref of [...(activity.input_artifact_ids ?? []), ...(activity.output_artifact_ids ?? [])])
      if (!artifactIds.has(ref)) errors.push(`activities.${activity.activity_id}.artifact:${ref}`)
  }
  return Object.freeze(errors)
}

export function compareResearchReplay(
  expected: ResearchRunManifest,
  actual: ResearchRunManifest,
): readonly string[] {
  const differences: string[] = []
  if (expected.instance_checksum !== actual.instance_checksum) differences.push('instance_checksum')
  if (expected.certificate_checksum !== actual.certificate_checksum) differences.push('certificate_checksum')
  if (expected.ruleset_checksum !== actual.ruleset_checksum) differences.push('ruleset_checksum')
  if (expected.activities.length !== actual.activities.length) differences.push('activities.length')
  expected.activities.forEach((activity, index) => {
    const other = actual.activities[index]
    if (!other) return
    if (activity.activity_id !== other.activity_id) differences.push(`activities[${index}].activity_id`)
    if (activity.status !== other.status) differences.push(`activities[${index}].status`)
    if (activity.output_artifact_ids?.join(',') !== other.output_artifact_ids?.join(','))
      differences.push(`activities[${index}].output_artifact_ids`)
  })
  if (expected.replay.deterministic !== actual.replay.deterministic) differences.push('replay.deterministic')
  if (sha256(expected.skill_refs) !== sha256(actual.skill_refs)) differences.push('skill_refs')
  if (sha256(expected.mcp_refs) !== sha256(actual.mcp_refs)) differences.push('mcp_refs')
  if (sha256(expected.artifacts) !== sha256(actual.artifacts)) differences.push('artifacts')
  if (sha256(expected.replay.command_refs) !== sha256(actual.replay.command_refs))
    differences.push('replay.command_refs')
  return Object.freeze([...new Set(differences)])
}

/** Unknown and failed tool receipts never become verified by accident. */
export function evidenceStatusFromVerification(status: Status, hasReceipt: boolean): ResearchEvidenceStatus {
  if (!hasReceipt) return status === 'fail' ? 'failed' : 'unknown'
  if (status === 'pass') return 'verified'
  if (status === 'warn') return 'partial'
  if (status === 'fail') return 'failed'
  return 'unknown'
}
