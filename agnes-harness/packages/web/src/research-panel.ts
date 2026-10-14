import type { UINode, UITimeline } from '@agnes/protocol'

export type SessionArtifactNode = Extract<UINode, { kind: 'artifact' }>
export type SessionToolNode = Extract<UINode, { kind: 'tool' }>

export type ResearchArtifactVersion = Readonly<{
  id: string
  version: string
  checksum: string
  role: 'input' | 'output'
  name: string
  mime: string
  size: number
  sequence: number
  sourceNodeId: string
}>

export type ResearchProvenanceNode = Readonly<{
  id: string
  kind: 'activity' | 'artifact' | 'evidence'
  label: string
  authority: 'authoritative' | 'advisory'
  completeness: 'complete' | 'partial' | 'incomplete'
}>

export type ResearchProvenanceEdge = Readonly<{
  from: string
  to: string
  relation: 'used' | 'generated' | 'supported-by'
}>

export type ResearchProvenanceGraph = Readonly<{
  schemaVersion: 1
  completeness: 'complete' | 'partial' | 'incomplete'
  reasonCodes: readonly string[]
  nodes: readonly ResearchProvenanceNode[]
  edges: readonly ResearchProvenanceEdge[]
}>

export type SessionResearchProjection = Readonly<{
  artifacts: readonly ResearchArtifactVersion[]
  graph: ResearchProvenanceGraph
}>

const activityStatus = (tool: SessionToolNode): ResearchProvenanceNode['completeness'] => {
  if (tool.status === 'completed') return 'complete'
  if (tool.status === 'failed' || tool.status === 'cancelled') return 'incomplete'
  return 'partial'
}

/**
 * Projects the session timeline into the portable Agnes Science panel contract.
 *
 * Artifact refs are authoritative ledger data. A tool-to-artifact edge is only
 * inferred when an artifact is emitted after a tool and before the next tool;
 * the resulting graph stays partial when the timeline cannot prove lineage.
 */
export function projectSessionResearch(timeline: UITimeline | undefined): SessionResearchProjection {
  const nodes = timeline?.nodes ?? []
  const artifacts: ResearchArtifactVersion[] = nodes
    .filter((node): node is SessionArtifactNode => node.kind === 'artifact')
    .sort((left, right) => left.seq - right.seq || left.id.localeCompare(right.id))
    .map((node) => ({
      id: node.id,
      version: `seq-${node.seq}`,
      checksum: node.ref.sha256,
      role: nodes.some((candidate) => candidate.kind === 'tool' && candidate.seq < node.seq)
        ? ('output' as const)
        : ('input' as const),
      name: node.name,
      mime: node.ref.mime,
      size: node.ref.size,
      sequence: node.seq,
      sourceNodeId: node.id,
    }))

  const tools = nodes
    .filter((node): node is SessionToolNode => node.kind === 'tool')
    .sort((left, right) => left.seq - right.seq || left.id.localeCompare(right.id))
  const graphNodes: ResearchProvenanceNode[] = artifacts.map((artifact) => ({
    id: `artifact:${artifact.id}@${artifact.version}`,
    kind: 'artifact',
    label: artifact.name,
    authority: 'authoritative',
    completeness: 'complete',
  }))
  const graphEdges: ResearchProvenanceEdge[] = []
  const reasons = new Set<string>()

  for (const tool of tools) {
    const activityId = `activity:${tool.id}`
    const activityCompleteness = activityStatus(tool)
    graphNodes.push({
      id: activityId,
      kind: 'activity',
      label: tool.name,
      authority: 'authoritative',
      completeness: activityCompleteness,
    })
    const nextTool = tools.find((candidate) => candidate.seq > tool.seq)
    const emitted = artifacts.filter(
      (artifact) =>
        artifact.sequence > tool.seq && (nextTool === undefined || artifact.sequence < nextTool.seq),
    )
    for (const artifact of emitted)
      graphEdges.push({
        from: activityId,
        to: `artifact:${artifact.id}@${artifact.version}`,
        relation: 'generated',
      })
    if (activityCompleteness !== 'complete') reasons.add('activity-evidence-partial')
    if (emitted.length === 0) reasons.add('missing-output-artifact')
    if (tool.resultPreview) {
      const evidenceId = `evidence:${tool.id}`
      graphNodes.push({
        id: evidenceId,
        kind: 'evidence',
        label: `${tool.name} result`,
        authority: 'advisory',
        completeness: activityCompleteness,
      })
      graphEdges.push({ from: activityId, to: evidenceId, relation: 'supported-by' })
    }
  }
  if (artifacts.length > 0 && tools.length === 0) reasons.add('compute-activity-lineage-missing')
  if (artifacts.length === 0 && tools.length > 0) reasons.add('missing-output-artifact')

  graphNodes.sort((left, right) => left.id.localeCompare(right.id))
  graphEdges.sort((left, right) =>
    `${left.from}|${left.to}|${left.relation}`.localeCompare(`${right.from}|${right.to}|${right.relation}`),
  )
  const graph: ResearchProvenanceGraph = Object.freeze({
    schemaVersion: 1,
    completeness: reasons.size === 0 ? 'complete' : 'partial',
    reasonCodes: Object.freeze([...reasons].sort()),
    nodes: Object.freeze(graphNodes),
    edges: Object.freeze(graphEdges),
  })
  return Object.freeze({ artifacts: Object.freeze(artifacts), graph })
}
