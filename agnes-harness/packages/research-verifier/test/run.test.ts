import { describe, expect, it } from 'vitest'
import {
  buildResearchRunManifest,
  compareResearchReplay,
  exportResearchRunPackage,
  researchEvent,
  validateResearchRunManifest,
  verifyResearchRunPackage,
} from '../src/index.js'

const activity = {
  activity_id: 'tool:read',
  kind: 'tool' as const,
  status: 'recorded' as const,
  started_at: '2026-10-07T00:00:00.000Z',
  caller: {
    agent: 'research-agent',
    mcp: { server_id: 'local', revision: 'r1', tool_name: 'read', schema_checksum: 'sha256:schema' },
  },
  parameter_summary: '{"path":"dataset.csv"}',
  approval: 'approved' as const,
  output_artifact_ids: ['dataset@1'],
  ledger_seqs: [2],
}

function manifest(status: 'recorded' | 'failed' = activity.status) {
  return buildResearchRunManifest({
    run_id: 'run-1',
    created_at: '2026-10-07T00:00:00.000Z',
    instance_checksum: 'sha256:instance',
    activities: [{ ...activity, status }],
    artifacts: [{ id: 'dataset', version: '1', checksum: 'sha256:data', role: 'input' }],
    replay: {
      recipe_id: 'run-1:replay',
      input_refs: ['dataset@1'],
      command_refs: ['read'],
      deterministic: true,
      state: 'available',
    },
  })
}

describe('research run contract', () => {
  it('emits structured research events and a stable manifest', () => {
    const event = researchEvent('research/activity', 2, 'evt-2', '2026-10-07T00:00:00.000Z', {
      run_id: 'run-1',
      activity,
    })
    expect(event.data.activity?.caller?.mcp?.schema_checksum).toBe('sha256:schema')
    expect(manifest().activities[0]?.activity_id).toBe('tool:read')
    expect(manifest().checksum).toBe(manifest().checksum)
  })

  it('models a synthetic Skill, built-in tool, and MCP activity tree', () => {
    const run = buildResearchRunManifest({
      run_id: 'synthetic-1',
      created_at: '2026-10-07T00:00:00.000Z',
      instance_checksum: 'sha256:instance',
      skill_refs: [
        { name: 'research-run', revision: 'skill@1', source: 'bundled', trust: 'trusted', actual: 'enabled' },
      ],
      mcp_refs: [
        {
          server_id: 'local-science',
          revision: 'server@1',
          tool_name: 'stats.describe',
          schema_checksum: 'sha256:schema',
          policy: 'offline',
        },
      ],
      activities: [
        {
          activity_id: 'skill:research-run',
          kind: 'skill',
          status: 'verified',
          started_at: activity.started_at,
          ended_at: activity.started_at,
          output_artifact_ids: ['plan@1'],
          replay: 'verified',
        },
        {
          ...activity,
          activity_id: 'tool:read',
          parent_id: 'skill:research-run',
          ended_at: activity.started_at,
          status: 'verified',
          replay: 'verified',
          output_artifact_ids: ['dataset@1'],
        },
        {
          activity_id: 'mcp:stats.describe',
          parent_id: 'skill:research-run',
          kind: 'tool',
          status: 'unknown',
          started_at: activity.started_at,
          ended_at: activity.started_at,
          replay: 'unavailable',
          output_artifact_ids: ['result@1'],
          caller: {
            mcp: {
              server_id: 'local-science',
              revision: 'server@1',
              tool_name: 'stats.describe',
              schema_checksum: 'sha256:schema',
            },
          },
        },
      ],
      artifacts: [
        { id: 'plan', version: '1', checksum: 'sha256:plan', role: 'source' },
        { id: 'dataset', version: '1', checksum: 'sha256:data', role: 'input' },
        { id: 'result', version: '1', checksum: 'sha256:result', role: 'output' },
      ],
    })
    expect(validateResearchRunManifest(run)).toEqual([])
    expect(run.activities).toHaveLength(3)
    expect(run.mcp_refs[0]?.schema_checksum).toBe('sha256:schema')
  })

  it('exports and verifies an offline package', () => {
    const pkg = exportResearchRunPackage({
      manifest: manifest(),
      ledger: [{ id: 'evt-2', seq: 2, type: 'research/activity', data: { run_id: 'run-1' } }],
      environment: { runtime: 'node' },
    })
    expect(verifyResearchRunPackage(pkg).every((check) => check.ok)).toBe(true)
    const changed = {
      ...pkg,
      files: { ...pkg.files, 'ledger.jsonl': `${pkg.files['ledger.jsonl']}\nchanged` },
    }
    expect(verifyResearchRunPackage(changed).some((check) => !check.ok)).toBe(true)
  })

  it('reports replay differences by stable field', () => {
    expect(compareResearchReplay(manifest(), manifest('failed'))).toContain('activities[0].status')
    expect(compareResearchReplay(manifest(), manifest())).toEqual([])
  })

  it('rejects incomplete activity bindings before replay', () => {
    const invalid = buildResearchRunManifest({
      run_id: 'run-2',
      created_at: '2026-10-07T00:00:00.000Z',
      instance_checksum: 'sha256:instance',
      activities: [
        { ...activity, status: 'failed', parent_id: 'missing', output_artifact_ids: ['missing@1'] },
      ],
      artifacts: [],
    })
    expect(validateResearchRunManifest(invalid)).toEqual([
      'activities.tool:read.parent_id',
      'activities.tool:read.ended_at',
      'activities.tool:read.artifact:missing@1',
    ])
  })
})
