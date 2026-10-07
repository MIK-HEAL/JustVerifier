import type { UINode } from '@agnes/protocol'
import { describe, expect, it } from 'vitest'
import { buildTraceRows, projectTraceResearchFromLedger } from '../src/trace.js'

describe('research trace sidecar', () => {
  it('joins evidence by node, tool use, or ledger sequence', () => {
    const nodes: UINode[] = [
      { kind: 'assistant', id: 'a1', seq: 1, text: 'plan' },
      {
        kind: 'tool',
        id: 't1',
        seq: 2,
        toolUseId: 'call-1',
        name: 'read',
        status: 'completed',
        summary: 'read dataset',
        enforcement: { level: 'full', scope: [] },
        children: [],
      } as UINode,
    ]
    const rows = buildTraceRows(nodes, [], {
      restoredFromLedger: true,
      activities: [
        { activityId: 'plan', nodeId: 'a1', status: 'verified', outputArtifacts: ['plan@1'] },
        { activityId: 'tool', toolUseId: 'call-1', ledgerSeq: 2, status: 'unknown', replay: 'unavailable' },
      ],
    })
    expect(rows.find((row) => row.id === 'a1')?.research?.status).toBe('verified')
    expect(rows.find((row) => row.id === 't1')?.research?.replay).toBe('unavailable')
    expect(rows.find((row) => row.id === 't1')?.research?.ledgerSeq).toBe(2)
  })

  it('rehydrates committed research activities after a refresh', () => {
    const snapshot = projectTraceResearchFromLedger([
      {
        seq: 7,
        type: 'research/activity',
        data: {
          activity: {
            activity_id: 'tool:read',
            node_id: 't1',
            status: 'unknown',
            output_artifact_ids: ['missing@1'],
            replay: 'unavailable',
          },
        },
      },
    ])
    expect(snapshot.restoredFromLedger).toBe(true)
    expect(snapshot.activities[0]).toMatchObject({
      activityId: 'tool:read',
      nodeId: 't1',
      ledgerSeq: 7,
      status: 'unknown',
    })
  })

  it('does not project hidden model thinking as evidence or trace content', () => {
    const row = buildTraceRows(
      [
        {
          kind: 'assistant',
          id: 'a2',
          seq: 1,
          text: 'published answer',
          thinking: 'private reasoning',
        } as UINode,
      ],
      [],
    )[0]
    expect(row?.preview).toBe('published answer')
    expect(row?.raw).toBe('published answer')
    expect(row?.preview).not.toContain('private reasoning')
  })
})
