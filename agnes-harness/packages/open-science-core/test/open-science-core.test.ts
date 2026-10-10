import { describe, expect, it } from 'vitest'
import {
  buildComputeExecutionReceipt,
  buildNotebookDocument,
  buildNotebookRunReceipt,
  buildProvenanceGraph,
  buildReproducibilityRecipe,
  compareOutputs,
  createArtifactVersionLocator,
  isSafeRemotePath,
  isSafeSkillReferenceName,
  literatureIdentifierUrl,
  normalizeLiteratureIdentifier,
  normalizeLiteratureReference,
  parseArtifactVersionLocator,
  parseExecutionFileEvidenceSummary,
  parseSkillFrontmatter,
  transitionComputeJob,
} from '../src/index.js'

describe('portable Open-Science contracts', () => {
  it('round-trips an opaque artifact locator', () => {
    const locator = createArtifactVersionLocator({ projectId: 'p/1', appSessionId: 's', artifactId: 'a', versionId: 'v' })
    expect(parseArtifactVersionLocator(locator)).toEqual({ projectId: 'p/1', appSessionId: 's', artifactId: 'a', versionId: 'v' })
    expect(parseArtifactVersionLocator('/workspace/result.csv')).toBeUndefined()
  })

  it('projects immutable artifact lineage and records missing evidence', () => {
    const graph = buildProvenanceGraph({
      artifacts: [{ id: 'input', version: '1', checksum: 'sha256:data', role: 'input' }],
      activities: [{ activityId: 'run', kind: 'notebook-run', status: 'unknown', sequence: 1, inputArtifactIds: ['input@1'], outputArtifactIds: ['missing@1'] }],
    })
    expect(graph.completeness).toBe('partial')
    expect(graph.reasonCodes).toContain('missing-output-artifact')
    expect(graph.checksum).toMatch(/^sha256:/u)
  })

  it('keeps replay comparison deterministic and bounded', () => {
    const report = compareOutputs({ expected: { p: 0.1, rows: [1, 2] }, actual: { p: 0.1001, rows: [1, 3] }, policy: { schemaVersion: 1, numericAbsoluteTolerance: 0.001, numericRelativeTolerance: 0, maxDifferences: 1 } })
    expect(report.outcome).toBe('different')
    expect(report.differences).toHaveLength(1)
    expect(report.detailsTruncated).toBe(true)
    expect(buildReproducibilityRecipe({ inputRefs: ['b', 'a', 'a'], commandRefs: ['run'], environmentFingerprint: 'sha256:env', deterministic: true }).inputRefs).toEqual(['a', 'b'])
  })

  it('normalizes literature IDs and makes a checksumed CSL-ready record', () => {
    expect(normalizeLiteratureIdentifier('doi', 'https://doi.org/10.1000/example.')).toBe('10.1000/example')
    expect(literatureIdentifierUrl('pmid', 'PMID:1234')).toBe('https://pubmed.ncbi.nlm.nih.gov/1234/')
    expect(normalizeLiteratureReference({ id: 'paper-1', title: ' Paper ', itemType: 'journalArticle', creators: [{ family: 'Doe' }], identifiers: [{ scheme: 'doi', value: 'doi:10.1000/x' }] }).checksum).toMatch(/^sha256:/u)
  })

  it('keeps notebook and compute receipts fail closed', () => {
    const notebook = buildNotebookDocument({ id: 'nb', version: '1', cells: [{ id: 'c1', source: '1 + 1', language: 'python' }] })
    const receipt = buildNotebookRunReceipt({ runId: 'run', notebookId: notebook.id, environment: { name: 'default', kernel: 'python', packages: [], lockChecksum: 'sha256:lock' }, status: 'completed', startedAt: '2026-10-10T00:00:00.000Z', cells: ['c1'], outputs: [{ kind: 'text', summary: '2', checksum: 'sha256:out' }], evidenceCoverage: 'complete' })
    expect(receipt.checksum).toMatch(/^sha256:/u)
    expect(buildComputeExecutionReceipt({ activityId: 'job', providerId: 'local', job: { jobId: 'j', backend: 'local', command: 'python run.py', workingDirectory: 'runs/j' }, status: 'completed', output: { state: 'available', reasonCodes: [] } }).checksum).toMatch(/^sha256:/u)
    expect(() => buildComputeExecutionReceipt({ activityId: 'job', providerId: 'local', job: { jobId: 'j', backend: 'local', command: 'x', workingDirectory: '../secret' }, status: 'completed', output: { state: 'available', reasonCodes: [] } })).toThrow()
    expect(transitionComputeJob('queued', 'submitted')).toBe('submitted')
  })

  it('parses safe Skill frontmatter and strict evidence sidecars', () => {
    expect(parseSkillFrontmatter('---\nname: demo\ndescription: A demo\n---\nBody')).toMatchObject({ name: 'demo', description: 'A demo', body: 'Body' })
    expect(isSafeSkillReferenceName('figure-style')).toBe(true)
    expect(isSafeSkillReferenceName('CON')).toBe(false)
    expect(parseExecutionFileEvidenceSummary({ schemaVersion: 1, activityKind: 'notebook-run', state: 'available', scientificOutputCount: 0, initialViewState: 'complete', managedRootsFinalState: 'complete', scientificOutputAnalysis: 'complete', fileReads: 'complete', externalPaths: 'complete', writerAttribution: 'complete', reasonCodes: [] })).toBeDefined()
    expect(isSafeRemotePath('runs/job/output.csv')).toBe(true)
    expect(isSafeRemotePath('../output.csv')).toBe(false)
  })
})
