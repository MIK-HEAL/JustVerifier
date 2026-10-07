import type { Certificate, EvidenceRef, VerificationReport } from './index.js'

export type EvidenceGraphNode = Readonly<{
  id: string
  kind: 'claim' | 'check' | 'evidence' | 'activity' | 'artifact'
  label: string
  authority: 'authoritative' | 'advisory'
  completeness: 'complete' | 'partial' | 'incomplete'
  source?: string
}>
export type EvidenceGraphEdge = Readonly<{ from: string; to: string; relation: string }>
export type EvidenceGraph = Readonly<{
  nodes: readonly EvidenceGraphNode[]
  edges: readonly EvidenceGraphEdge[]
}>

const evidenceNode = (evidence: EvidenceRef): EvidenceGraphNode => ({
  id: evidence.ref,
  kind:
    evidence.kind === 'artifact-version'
      ? 'artifact'
      : evidence.kind === 'ledger-event'
        ? 'activity'
        : 'evidence',
  label: evidence.ref,
  authority: 'authoritative',
  completeness:
    evidence.coverage === 'available' || evidence.coverage === undefined
      ? 'complete'
      : evidence.coverage === 'partial'
        ? 'partial'
        : 'incomplete',
  source: evidence.kind,
})

/** Converts a report into a stable, queryable claim -> checks -> evidence graph. */
export function projectEvidenceGraph(certificate: Certificate, report: VerificationReport): EvidenceGraph {
  const nodes: EvidenceGraphNode[] = [
    {
      id: `claim:${certificate.claim.id}`,
      kind: 'claim',
      label: certificate.claim.text,
      authority: 'advisory',
      completeness: 'complete',
    },
  ]
  const edges: EvidenceGraphEdge[] = []
  const byRef = new Map(certificate.evidence.map((evidence) => [evidence.ref, evidence]))
  for (const result of report.results) {
    const checkId = `check:${result.rule_id}`
    nodes.push({
      id: checkId,
      kind: 'check',
      label: `${result.rule_id}: ${result.status}`,
      authority: 'authoritative',
      completeness:
        result.status === 'pass' ? 'complete' : result.status === 'warn' ? 'partial' : 'incomplete',
    })
    edges.push({ from: `claim:${certificate.claim.id}`, to: checkId, relation: 'checked-by' })
    for (const ref of result.evidence_refs) {
      const evidence = byRef.get(ref)
      const node = evidence
        ? evidenceNode(evidence)
        : {
            id: ref,
            kind: 'evidence' as const,
            label: ref,
            authority: 'authoritative' as const,
            completeness: 'incomplete' as const,
          }
      if (!nodes.some((candidate) => candidate.id === node.id)) nodes.push(node)
      edges.push({ from: checkId, to: node.id, relation: 'supported-by' })
    }
  }
  nodes.sort((a, b) => a.id.localeCompare(b.id))
  edges.sort((a, b) => `${a.from}|${a.to}|${a.relation}`.localeCompare(`${b.from}|${b.to}|${b.relation}`))
  return Object.freeze({ nodes: Object.freeze(nodes), edges: Object.freeze(edges) })
}
