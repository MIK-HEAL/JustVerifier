import { describe, expect, it } from 'vitest'
import { buildNotebookRunReceipt } from '@agnes/open-science-core'
import { researchActivityFromComputeJob, researchActivityFromNotebookRun, researchArtifactFromOpenScience } from '../src/index.js'

describe('Open-Science to research manifest adapter', () => {
  it('maps artifact versions without leaking paths', () => {
    const artifact = researchArtifactFromOpenScience({ id: 'result', version: '2', checksum: 'sha256:result', role: 'output', filename: 'result.csv', locator: 'C:/secret/result.csv' })
    expect(artifact).toEqual({ id: 'result', version: '2', checksum: 'sha256:result', role: 'output' })
  })

  it('keeps incomplete Notebook evidence partial or unknown', () => {
    const receipt = buildNotebookRunReceipt({
      runId: 'r1', notebookId: 'nb', environment: { name: 'default', kernel: 'python', packages: [] }, status: 'completed', startedAt: '2026-10-10T00:00:00.000Z', cells: ['c1'], outputs: [{ kind: 'text', summary: 'done' }], evidenceCoverage: 'partial',
    })
    expect(researchActivityFromNotebookRun(receipt).status).toBe('unknown')
  })

  it('maps compute receipts into the same trace activity shape', () => {
    const activity = researchActivityFromComputeJob({
      schemaVersion: 1, activityId: 'job-1', providerId: 'ssh', job: { jobId: 'j', backend: 'ssh', command: 'python run.py', workingDirectory: 'runs/j' }, status: 'completed', output: { state: 'available', reasonCodes: [] }, checksum: 'sha256:receipt',
    })
    expect(activity.activity_id).toBe('compute:job-1')
    expect(activity.status).toBe('verified')
  })
})
