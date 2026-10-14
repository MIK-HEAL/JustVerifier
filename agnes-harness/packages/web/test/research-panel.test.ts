import type { UITimeline } from '@agnes/protocol'
import { describe, expect, it } from 'vitest'
import { projectSessionResearch } from '../src/research-panel.js'

const timeline = (nodes: UITimeline['nodes']): UITimeline => ({
  sessionId: 'research-session',
  upto: nodes.at(-1)?.seq ?? 0,
  generation: 1,
  opState: null,
  nodes,
  turns: [],
})

describe('session research projection', () => {
  it('exposes artifact metadata and a generated provenance edge', () => {
    const projection = projectSessionResearch(
      timeline([
        {
          kind: 'tool',
          id: 'tool-1',
          seq: 1,
          toolUseId: 'call-1',
          name: 'science_write_artifact_file',
          status: 'completed',
          summary: 'published result',
          resultPreview: 'artifact stored',
        },
        {
          kind: 'artifact',
          id: 'artifact-1',
          seq: 2,
          name: 'result.csv',
          ref: { sha256: 'a'.repeat(64), size: 4096, mime: 'text/csv' },
        },
      ]),
    )

    expect(projection.artifacts).toMatchObject([
      { id: 'artifact-1', version: 'seq-2', role: 'output', name: 'result.csv', checksum: 'a'.repeat(64) },
    ])
    expect(projection.graph.completeness).toBe('complete')
    expect(projection.graph.edges).toEqual(
      expect.arrayContaining([
        { from: 'activity:tool-1', to: 'artifact:artifact-1@seq-2', relation: 'generated' },
        { from: 'activity:tool-1', to: 'evidence:tool-1', relation: 'supported-by' },
      ]),
    )
  })

  it('marks an artifact without an activity as partial instead of inventing lineage', () => {
    const projection = projectSessionResearch(
      timeline([
        {
          kind: 'artifact',
          id: 'artifact-1',
          seq: 1,
          name: 'uploaded.pdf',
          ref: { sha256: 'b'.repeat(64), size: 12, mime: 'application/pdf' },
        },
      ]),
    )

    expect(projection.graph.completeness).toBe('partial')
    expect(projection.graph.reasonCodes).toContain('compute-activity-lineage-missing')
    expect(projection.graph.edges).toHaveLength(0)
  })
})
