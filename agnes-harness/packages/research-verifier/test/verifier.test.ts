import { describe, expect, it } from 'vitest'
import {
  type Certificate,
  sha256,
  type VerificationInput,
  verificationExitCode,
  verifyCertificate,
} from '../src/index.js'
import { buildExecutionManifest } from '../src/manifest.js'
import { projectEvidenceGraph } from '../src/projection.js'

const certificate: Certificate = {
  schema_version: 1,
  claim: {
    id: 'claim-1',
    text: 'p is significant',
    kind: 'derived-result',
    scope: { dataset: 'dataset@1', variable: 'p_value' },
  },
  instance: {
    dataset_version_id: 'dataset@1',
    dataset_checksum: 'sha256:dataset',
    analysis_spec_checksum: 'sha256:spec',
    assumption_ids: ['independent'],
  },
  witness: {
    source_code_version_id: 'code@1',
    execution_id: 'run-1',
    input_version_ids: ['dataset@1'],
    output_version_ids: ['report@1'],
    environment_fingerprint: 'sha256:env',
    result_fields: [{ path: 'table.p_value', value: 0.031 }],
  },
  evidence: [{ kind: 'ledger-event', ref: 'ev-1', checksum: 'sha256:ev', coverage: 'available' }],
  assumptions: [
    {
      id: 'independent',
      statement: 'Samples are independent',
      required_for: ['claim-1'],
      observable_checks: ['independence-test'],
      status: 'satisfied',
      evidence_refs: ['ev-1'],
    },
  ],
}
const input = (): VerificationInput => ({
  certificate,
  artifacts: [
    { id: 'dataset', version: '1', checksum: 'sha256:dataset' },
    {
      id: 'report',
      version: '1',
      checksum: 'sha256:report',
      result_fields: certificate.witness.result_fields,
    },
  ],
  ledger: [
    { id: 'start', seq: 1, type: 'step/start', data: { execution_id: 'run-1' } },
    { id: 'tool', seq: 2, type: 'tool/result', data: { execution_id: 'run-1' } },
    { id: 'end', seq: 3, type: 'step/end', data: { execution_id: 'run-1' } },
  ],
  replay: { execution_id: 'run-1', result_fields: certificate.witness.result_fields, deterministic: true },
})

describe('research verifier', () => {
  it('accepts a complete certificate deterministically', () => {
    const a = verifyCertificate(input())
    const b = verifyCertificate(input())
    expect(a.status).toBe('pass')
    expect(a).toEqual(b)
    expect(verificationExitCode(a.status)).toBe(0)
  })
  it('rejects changed output and missing ledger evidence', () => {
    const x = input()
    x.certificate = {
      ...certificate,
      witness: { ...certificate.witness, result_fields: [{ path: 'table.p_value', value: 0.032 }] },
    }
    x.ledger = x.ledger.slice(0, 2)
    const report = verifyCertificate(x)
    expect(report.status).toBe('fail')
    expect(report.results.find((r) => r.rule_id === 'output-binding')?.status).toBe('fail')
    expect(report.results.find((r) => r.rule_id === 'ledger-binding')?.status).toBe('fail')
  })
  it('keeps unknown assumptions distinct from pass', () => {
    const x = input()
    const assumption = certificate.assumptions?.[0]
    if (!assumption) throw new Error('fixture assumption missing')
    x.certificate = {
      ...certificate,
      assumptions: [{ ...assumption, status: 'unknown', unknown_reason: 'no check' }],
    }
    const report = verifyCertificate(x)
    expect(report.status).toBe('unknown')
    expect(report.results.find((r) => r.rule_id === 'assumption-status')?.status).toBe('unknown')
  })
  it('uses stable checksums for structured values', () => {
    expect(sha256({ b: 2, a: 1 })).toBe(sha256({ a: 1, b: 2 }))
  })
  it('builds a repeatable path-free execution manifest', () => {
    const snapshot = {
      execution_id: 'run-1',
      ledger: input().ledger,
      artifacts: input().artifacts,
      certificate: {
        ...certificate,
        skills: [{ id: 'research-run', version: '1.0.0', source: 'open-science', trust: 'trusted' as const }],
      },
    }
    const first = buildExecutionManifest(snapshot)
    const second = buildExecutionManifest({
      ...snapshot,
      ledger: [...snapshot.ledger].reverse(),
      artifacts: [...snapshot.artifacts].reverse(),
    })
    expect(first).toEqual(second)
    expect(JSON.stringify(first)).not.toContain('C:\\')
    expect(first.events.map((event) => event.id)).toEqual(['start', 'tool', 'end'])
    expect(first.certificate?.skills?.[0]?.source).toBe('open-science')
  })
  it('projects each rule and its evidence into a stable graph', () => {
    const report = verifyCertificate(input())
    const graph = projectEvidenceGraph(certificate, report)
    expect(graph.nodes.some((node) => node.id === 'claim:claim-1')).toBe(true)
    expect(graph.nodes.some((node) => node.id === 'check:output-binding')).toBe(true)
    expect(graph.edges).toContainEqual({
      from: 'claim:claim-1',
      to: 'check:output-binding',
      relation: 'checked-by',
    })
  })
  it.each([
    [
      'missing output artifact',
      (x: VerificationInput) => {
        x.artifacts = x.artifacts.filter((artifact) => artifact.id !== 'report')
      },
      'output-binding',
    ],
    [
      'changed input checksum',
      (x: VerificationInput) => {
        const first = x.artifacts[0]
        if (first) x.artifacts[0] = { ...first, checksum: 'sha256:changed' }
      },
      'instance-integrity',
    ],
    [
      'missing execution event',
      (x: VerificationInput) => {
        x.ledger = x.ledger.filter((event) => event.type !== 'step/end')
      },
      'ledger-binding',
    ],
    [
      'partial evidence',
      (x: VerificationInput) => {
        const evidence = certificate.evidence[0]
        if (evidence) x.certificate = { ...certificate, evidence: [{ ...evidence, coverage: 'partial' }] }
      },
      'evidence-coverage',
    ],
    [
      'missing required assumption',
      (x: VerificationInput) => {
        x.certificate = { ...certificate, assumptions: [] }
      },
      'assumption-status',
    ],
    [
      'nonexistent immutable evidence',
      (x: VerificationInput) => {
        x.certificate = {
          ...certificate,
          evidence: [{ kind: 'artifact-version', ref: 'artifact:missing@1', checksum: 'sha256:missing' }],
        }
      },
      'evidence-coverage',
    ],
  ])('locates %s at %s', (_name, mutate, ruleId) => {
    const x = input()
    mutate(x)
    const report = verifyCertificate(x)
    expect(report.results.find((result) => result.rule_id === ruleId)?.status).toMatch(/fail|warn|unknown/)
    expect(report.results.some((result) => result.rule_id === ruleId && result.message.length > 0)).toBe(true)
  })
})
