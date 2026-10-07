import { type Artifact, type ArtifactRef, type Certificate, type LedgerEvent, sha256 } from './index.js'

export type ExecutionManifest = Readonly<{
  schema_version: 1
  execution_id: string
  events: readonly LedgerEvent[]
  artifacts: readonly ArtifactRef[]
  certificate?: Pick<Certificate, 'schema_version' | 'ruleset_checksum' | 'skills'>
  checksum: string
}>

export type ResearchRunSnapshot = Readonly<{
  execution_id: string
  ledger: readonly LedgerEvent[]
  artifacts: readonly Artifact[]
  certificate?: Certificate
}>

/** Creates a path-free, deterministic derivative of one ledger run. */
export function buildExecutionManifest(snapshot: ResearchRunSnapshot): ExecutionManifest {
  const events = snapshot.ledger
    .filter(
      (event) =>
        event.data?.execution_id === snapshot.execution_id ||
        event.data?.executionId === snapshot.execution_id,
    )
    .sort((a, b) => a.seq - b.seq || a.id.localeCompare(b.id))
    .map((event) => ({ ...event }))
  const artifacts = snapshot.artifacts
    .map(({ id, version, checksum, kind }) => ({ id, version, checksum, ...(kind ? { kind } : {}) }))
    .sort((a, b) => `${a.id}@${a.version}`.localeCompare(`${b.id}@${b.version}`))
  const base = {
    schema_version: 1 as const,
    execution_id: snapshot.execution_id,
    events,
    artifacts,
    ...(snapshot.certificate
      ? {
          certificate: {
            schema_version: snapshot.certificate.schema_version,
            ...(snapshot.certificate.ruleset_checksum
              ? { ruleset_checksum: snapshot.certificate.ruleset_checksum }
              : {}),
            ...(snapshot.certificate.skills ? { skills: snapshot.certificate.skills } : {}),
          },
        }
      : {}),
  }
  return Object.freeze({ ...base, checksum: sha256(base) })
}

export function manifestEvidenceRefs(manifest: ExecutionManifest): readonly string[] {
  return Object.freeze(
    [
      ...manifest.events.map((event) => `ledger:${event.id}`),
      ...manifest.artifacts.map((artifact) => `artifact:${artifact.id}@${artifact.version}`),
    ].sort(),
  )
}
