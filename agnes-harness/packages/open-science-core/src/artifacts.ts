import { freezeDeep, sha256 } from './canonical.js'

export type ArtifactRole = 'input' | 'output' | 'source' | 'receipt' | 'environment' | 'certificate'

export type ArtifactVersion = Readonly<{
  id: string
  version: string
  checksum: string
  role: ArtifactRole
  filename?: string
  content_type?: string
  size?: number
  title?: string
  locator?: string
}>

export type ArtifactVersionIdentity = Readonly<{
  projectId: string
  appSessionId: string
  artifactId: string
  versionId: string
}>

const LOCATOR_PREFIX = 'artifact-version:'

/** Root-independent identity used in manifests and UI state instead of a machine path. */
export function createArtifactVersionLocator(identity: ArtifactVersionIdentity): string {
  return `${LOCATOR_PREFIX}${[
    identity.projectId,
    identity.appSessionId,
    identity.artifactId,
    identity.versionId,
  ]
    .map(encodeURIComponent)
    .join('/')}`
}

export function parseArtifactVersionLocator(value: string): ArtifactVersionIdentity | undefined {
  if (!value.startsWith(LOCATOR_PREFIX)) return undefined
  const parts = value.slice(LOCATOR_PREFIX.length).split('/')
  if (parts.length !== 4 || parts.some((part) => part.length === 0)) return undefined
  try {
    const [projectId, appSessionId, artifactId, versionId] = parts.map(decodeURIComponent)
    if (!projectId || !appSessionId || !artifactId || !versionId) return undefined
    return { projectId, appSessionId, artifactId, versionId }
  } catch {
    return undefined
  }
}

export type ProvenanceActivity = Readonly<{
  activityId: string
  kind: 'notebook-run' | 'compute-job' | 'artifact-publication' | 'tool'
  status: 'recorded' | 'verified' | 'partial' | 'unknown' | 'failed'
  sequence: number
  parentActivityId?: string
  inputArtifactIds?: readonly string[]
  outputArtifactIds?: readonly string[]
  evidenceRefs?: readonly string[]
}>

export type ProvenanceGraphNode = Readonly<{
  id: string
  kind: 'activity' | 'artifact' | 'evidence'
  label: string
  authority: 'authoritative' | 'advisory'
  completeness: 'complete' | 'partial' | 'incomplete'
}>

export type ProvenanceGraphEdge = Readonly<{
  from: string
  to: string
  relation: 'used' | 'generated' | 'supported-by' | 'parent'
}>

export type ProvenanceGraph = Readonly<{
  schemaVersion: 1
  checksum: string
  completeness: 'complete' | 'partial' | 'incomplete'
  reasonCodes: readonly string[]
  nodes: readonly ProvenanceGraphNode[]
  edges: readonly ProvenanceGraphEdge[]
}>

function completeness(status: ProvenanceActivity['status']): ProvenanceGraphNode['completeness'] {
  return status === 'verified' || status === 'recorded'
    ? 'complete'
    : status === 'partial' || status === 'unknown'
      ? 'partial'
      : 'incomplete'
}

/** Projects run activities into a stable claimable graph without retaining filesystem paths. */
export function buildProvenanceGraph(input: Readonly<{
  activities: readonly ProvenanceActivity[]
  artifacts: readonly ArtifactVersion[]
}>): ProvenanceGraph {
  const artifactByRef = new Map(input.artifacts.map((artifact) => [`${artifact.id}@${artifact.version}`, artifact]))
  const nodes: ProvenanceGraphNode[] = []
  const edges: ProvenanceGraphEdge[] = []
  const reasons = new Set<string>()
  for (const artifact of input.artifacts) {
    nodes.push({
      id: `artifact:${artifact.id}@${artifact.version}`,
      kind: 'artifact',
      label: artifact.filename ?? `${artifact.id}@${artifact.version}`,
      authority: 'authoritative',
      completeness: artifact.checksum ? 'complete' : 'incomplete',
    })
  }
  for (const activity of [...input.activities].sort((a, b) => a.activityId.localeCompare(b.activityId))) {
    const activityId = `activity:${activity.activityId}`
    nodes.push({
      id: activityId,
      kind: 'activity',
      label: activity.activityId,
      authority: 'authoritative',
      completeness: completeness(activity.status),
    })
    if (activity.parentActivityId) edges.push({ from: activityId, to: `activity:${activity.parentActivityId}`, relation: 'parent' })
    for (const ref of activity.inputArtifactIds ?? []) {
      if (!artifactByRef.has(ref)) reasons.add('missing-input-artifact')
      edges.push({ from: activityId, to: `artifact:${ref}`, relation: 'used' })
    }
    for (const ref of activity.outputArtifactIds ?? []) {
      if (!artifactByRef.has(ref)) reasons.add('missing-output-artifact')
      edges.push({ from: activityId, to: `artifact:${ref}`, relation: 'generated' })
    }
    for (const ref of activity.evidenceRefs ?? []) {
      nodes.push({ id: `evidence:${ref}`, kind: 'evidence', label: ref, authority: 'authoritative', completeness: completeness(activity.status) })
      edges.push({ from: activityId, to: `evidence:${ref}`, relation: 'supported-by' })
    }
    if (activity.status === 'unknown') reasons.add('activity-evidence-partial')
  }
  nodes.sort((a, b) => a.id.localeCompare(b.id))
  edges.sort((a, b) => `${a.from}|${a.to}|${a.relation}`.localeCompare(`${b.from}|${b.to}|${b.relation}`))
  const base = {
    schemaVersion: 1 as const,
    completeness: reasons.size ? 'partial' as const : 'complete' as const,
    reasonCodes: [...reasons].sort(),
    nodes,
    edges,
  }
  return freezeDeep({ ...base, checksum: sha256(base) })
}
