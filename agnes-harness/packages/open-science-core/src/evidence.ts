export type EvidenceCoverage = 'complete' | 'partial' | 'unavailable'
export type EvidenceState = 'available' | 'partial' | 'unavailable'

export type EvidenceReason =
  | 'file-reads-not-observed'
  | 'initial-file-generations-not-captured'
  | 'external-paths-not-observed'
  | 'remote-outputs-not-observed'
  | 'transient-files-not-captured'
  | 'delayed-writes-not-observed'
  | 'writer-not-isolated'
  | 'watcher-unavailable'
  | 'observation-not-started'
  | 'observer-conflict'
  | 'observer-limit-exceeded'
  | 'observer-failed'
  | 'generation-budget-exceeded'
  | 'generation-freeze-failed'
  | 'evidence-persistence-failed'
  | 'activity-identity-missing'
  | 'remote-input-generation-not-captured'
  | 'remote-output-not-harvested'
  | 'harvest-incomplete'
  | 'compute-activity-lineage-missing'
  | 'dynamic-path-unresolved'
  | 'absolute-path-not-frozen'
  | 'execution-incomplete'

export type ScientificOutputStorageShape = 'single-file' | 'file-set' | 'directory-tree'
export type ScientificOutputRisk =
  | 'format-validity-not-verified'
  | 'multi-file-consistency-not-verified'
  | 'database-state-not-verified'
  | 'runtime-dependent-serialization'

export type ScientificOutputEvidence = Readonly<{
  outputId: string
  storageShape: ScientificOutputStorageShape
  formatHint?: string
  members: readonly string[]
  riskCodes: readonly ScientificOutputRisk[]
}>

export type ExecutionFileEvidenceSummary = Readonly<{
  schemaVersion: 1
  activityId?: string
  activityKind: 'notebook-run' | 'compute-job'
  parentActivityId?: string
  state: EvidenceState
  evidenceId?: string
  checksum?: string
  storageKey?: string
  relationCount?: number
  generationCount?: number
  scientificOutputCount: number
  initialViewState: EvidenceCoverage
  managedRootsFinalState: EvidenceCoverage
  scientificOutputAnalysis: EvidenceCoverage
  fileReads: EvidenceCoverage
  externalPaths: EvidenceCoverage
  writerAttribution: EvidenceCoverage
  reasonCodes: readonly EvidenceReason[]
}>

const SHA256 = /^sha256:[a-f0-9]{64}$/u
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u
const REASONS = new Set<string>([
  'file-reads-not-observed', 'initial-file-generations-not-captured', 'external-paths-not-observed',
  'remote-outputs-not-observed', 'transient-files-not-captured', 'delayed-writes-not-observed',
  'writer-not-isolated', 'watcher-unavailable', 'observation-not-started', 'observer-conflict',
  'observer-limit-exceeded', 'observer-failed', 'generation-budget-exceeded', 'generation-freeze-failed',
  'evidence-persistence-failed', 'activity-identity-missing', 'remote-input-generation-not-captured',
  'remote-output-not-harvested', 'harvest-incomplete', 'compute-activity-lineage-missing',
  'dynamic-path-unresolved', 'absolute-path-not-frozen', 'execution-incomplete',
])
const COVERAGE = new Set(['complete', 'partial', 'unavailable'])
const STATES = new Set(['available', 'partial', 'unavailable'])
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const isCount = (value: unknown): boolean => value === undefined || (Number.isSafeInteger(value) && Number(value) >= 0)
const isStorageKey = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && !value.startsWith('/') && !/^[A-Za-z]:[\\/]/u.test(value) && !value.includes('\\') && value.split('/').every((part) => part && part !== '.' && part !== '..')

/** Strict parser used at trust boundaries; malformed sidecars remain unavailable. */
export function parseExecutionFileEvidenceSummary(value: unknown): ExecutionFileEvidenceSummary | undefined {
  if (!isRecord(value)) return undefined
  const stringId = (field: string): boolean => value[field] === undefined || (typeof value[field] === 'string' && SAFE_ID.test(value[field] as string))
  const coverage = (field: string): boolean => typeof value[field] === 'string' && COVERAGE.has(value[field] as string)
  if (
    value.schemaVersion !== 1 || typeof value.activityKind !== 'string' || !['notebook-run', 'compute-job'].includes(value.activityKind) ||
    typeof value.state !== 'string' || !STATES.has(value.state) || !stringId('activityId') || !stringId('parentActivityId') ||
    (value.evidenceId !== undefined && (typeof value.evidenceId !== 'string' || !value.evidenceId)) ||
    (value.checksum !== undefined && (typeof value.checksum !== 'string' || !SHA256.test(value.checksum))) ||
    (value.storageKey !== undefined && !isStorageKey(value.storageKey)) || !isCount(value.relationCount) || !isCount(value.generationCount) ||
    !Number.isSafeInteger(value.scientificOutputCount) || Number(value.scientificOutputCount) < 0 ||
    !coverage('initialViewState') || !coverage('managedRootsFinalState') || !coverage('scientificOutputAnalysis') ||
    !coverage('fileReads') || !coverage('externalPaths') || !coverage('writerAttribution') || !Array.isArray(value.reasonCodes) ||
    value.reasonCodes.some((reason) => typeof reason !== 'string' || !REASONS.has(reason))
  ) return undefined
  return value as ExecutionFileEvidenceSummary
}

export function hasImmutableEvidenceReference(summary: ExecutionFileEvidenceSummary | undefined): summary is ExecutionFileEvidenceSummary & { evidenceId: string; checksum: string; storageKey: string } {
  return !!summary?.evidenceId && !!summary.checksum && !!summary.storageKey
}
