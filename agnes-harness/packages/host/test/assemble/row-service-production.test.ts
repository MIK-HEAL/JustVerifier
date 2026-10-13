import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { ChildControlStore } from '@agnes/core'
import { hashDirectory, type RuntimePluginSnapshot } from '@agnes/package-manager'
import { buildRuntimeTarget, createPluginRow } from '@agnes/plugin-runtime/host'
import type { InferenceEvent } from '@agnes/protocol'
import { expect, it } from 'vitest'
import { pluginRowSource } from '../../src/ext-host/row-extension-host.js'
import { createTestHost } from '../../testkit/index.js'

it('loads a third-party row query service and removes it when the row is disabled', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'agnes-row-service-'))
  const packageDirectory = resolve(dataDir, 'panel')
  await cp(
    fileURLToPath(new URL('../../../../examples/packages/client-service-panel/v1/', import.meta.url)),
    packageDirectory,
    { recursive: true },
  )
  const packageId = '@agnes-examples/client-service-panel'
  const rowId = 'ext:examples/client-service-panel/runtime'
  const snapshotId = `sha256-${'8'.repeat(64)}`
  const source: RuntimePluginSnapshot = {
    snapshot: {
      snapshotId,
      profile: 'local-dev',
      packageId,
      version: '1.0.0',
      integrity: snapshotId,
      treeIntegrity: hashDirectory(packageDirectory, { exclude: [] }),
      capabilityHash: 'fixture',
      directory: packageDirectory,
      contributions: [],
    },
    generation: 1,
    trusted: true,
  }
  const owner = pluginRowSource(rowId)
  const row = createPluginRow({
    id: rowId,
    plugin: `${packageId}@${snapshotId}/runtime`,
    snapshotDigest: snapshotId,
    exportName: 'runtime',
    entryRevision: snapshotId,
    extrasRevision: 'none',
    mountRevision: 'host-ordinary-row:v1',
    runtime: 'in-process',
  })
  const target = (disabled: boolean) =>
    buildRuntimeTarget({
      rows: [{ ...row, disabled }],
      resources: { mcp: [], skills: {} },
      resourceRevision: '0'.repeat(64),
      compositeRevision: '0'.repeat(64),
    })
  try {
    const { host } = await createTestHost({
      dataDir,
      runtimePluginCatalogue: [source],
      extensionLoader: {
        import: async (file) => (await import(pathToFileURL(file).href)) as Record<string, unknown>,
      },
      serviceAuthority: {
        async resolve() {
          return {
            source: 'client-web',
            subjectCredential: { kind: 'local' },
            grants: [{ extension: owner, name: 'panel.version', range: '*' }],
          }
        },
      },
    })
    try {
      await host.applyRuntimeTarget(target(false))
      const session = await host.createSession({ cwd: dataDir, key: 'row-service' })
      await expect(
        host.callService(
          { sessionId: session.key, extension: owner, service: 'panel.version', input: {} },
          { kind: 'local' },
        ),
      ).resolves.toEqual({ output: { version: '1.0.0' } })
      await host.applyRuntimeTarget(target(true))
      await expect(
        host.callService(
          { sessionId: session.key, extension: owner, service: 'panel.version', input: {} },
          { kind: 'local' },
        ),
      ).rejects.toThrow()
      await host.applyRuntimeTarget(target(false))
      await expect(
        host.callService(
          { sessionId: session.key, extension: owner, service: 'panel.version', input: {} },
          { kind: 'local' },
        ),
      ).resolves.toEqual({ output: { version: '1.0.0' } })
      await session.close()
    } finally {
      await host.close()
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

it('runs a queued research DAG through actual Host children and records a conservative report', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'agnes-research-row-'))
  const packageDirectory = join(dataDir, 'research-verifier')
  await cp(
    fileURLToPath(new URL('../../../package-manager/bundled-plugins/research-verifier/', import.meta.url)),
    packageDirectory,
    { recursive: true },
  )
  const packageId = '@agnes/research-verifier'
  const rowId = 'ext:research-verifier/main'
  const snapshotId = `sha256-${'9'.repeat(64)}`
  const source: RuntimePluginSnapshot = {
    snapshot: {
      snapshotId,
      profile: 'local-dev',
      packageId,
      version: '0.1.0',
      integrity: snapshotId,
      treeIntegrity: hashDirectory(packageDirectory, { exclude: [] }),
      capabilityHash: 'fixture',
      directory: packageDirectory,
      contributions: [],
    },
    generation: 1,
    trusted: true,
  }
  const row = createPluginRow({
    id: rowId,
    plugin: `${packageId}@${snapshotId}/researchVerifier`,
    snapshotDigest: snapshotId,
    exportName: 'researchVerifier',
    inject: ['extension'],
    entryRevision: snapshotId,
    extrasRevision: 'none',
    mountRevision: 'host-ordinary-row:v1',
    runtime: 'in-process',
  })
  const owner = pluginRowSource(rowId)
  const args = { run_id: 'pending' }
  const dispatch: InferenceEvent[] = [
    {
      type: 'toolcall_end',
      via: 'native',
      call: { toolUseId: '', name: 'research_multiagent_run', args, ordinal: 0 },
    },
    { type: 'done', reason: 'toolUse' },
  ]
  const say = (text: string): InferenceEvent[] => [{ type: 'text_delta', delta: text }]
  const artifactsDir = join(dataDir, 'artifacts')
  await mkdir(artifactsDir)
  const { host } = await createTestHost({
    dataDir,
    treeBudgetCredits: 100,
    seams: {
      artifacts: {
        put: async (bytes, meta) => {
          const sha256 = createHash('sha256').update(bytes).digest('hex')
          await writeFile(join(artifactsDir, sha256), bytes)
          return { sha256, size: bytes.length, mime: meta?.mime ?? 'application/octet-stream' }
        },
        get: async (ref) => new Uint8Array(await readFile(join(artifactsDir, ref.sha256))),
        submitJob: async () => {
          throw new Error('not used')
        },
        poll: async () => {
          throw new Error('not used')
        },
        cancel: async () => undefined,
      },
    },
    packageDirs: {
      '@agnes/base': fileURLToPath(new URL('../../../base', import.meta.url)),
      '@agnes/code': fileURLToPath(new URL('../../../code', import.meta.url)),
    },
    script: [
      dispatch,
      say('planner observations'),
      say('executor observations'),
      say('reviewer observations'),
    ],
    runtimePluginCatalogue: [source],
    extensionLoader: { import: async (file) => await import(pathToFileURL(file).href) },
    serviceAuthority: {
      resolve: async () => ({
        source: 'client-web',
        subjectCredential: { kind: 'local' },
        grants: ['start', 'status', 'cancel'].map((name) => ({
          extension: owner,
          name: `research.multiagent.${name}`,
          range: '*',
        })),
      }),
    },
  })
  try {
    await host.applyRuntimeTarget(
      buildRuntimeTarget({
        rows: [row],
        resources: { mcp: [], skills: {} },
        resourceRevision: '0'.repeat(64),
        compositeRevision: '0'.repeat(64),
      }),
    )
    const session = await host.createSession({ cwd: dataDir, key: 'research-host' })
    const verifier = await import(pathToFileURL(join(packageDirectory, 'src/verifier.mjs')).href)
    const plan = verifier.buildMultiAgentPlan({
      plan_id: 'host-plan',
      run_id: 'host-run',
      root_agent_id: 'planner',
      agents: ['planner', 'executor', 'reviewer'].map((role) => ({
        agent_id: role,
        role,
        revision: '1',
        capabilities: [],
      })),
      tasks: ['planner', 'executor', 'reviewer'].map((role, index, roles) => ({
        task_id: role,
        agent_id: role,
        mode: 'serial',
        output_namespace: `${role}/output`,
        ...(index ? { depends_on: [roles[index - 1]] } : {}),
      })),
    })
    const accepted = await host.callService(
      {
        sessionId: session.key,
        extension: owner,
        service: 'research.multiagent.start',
        commandId: 'research-start',
        input: { prompt: 'verify a synthetic claim', plan, session_id: 'spoofed' },
      },
      { kind: 'local' },
      undefined,
      { commandId: 'research-start' },
    )
    args.run_id = (accepted.output as { run_id: string }).run_id
    await session.enqueue('next-turn', {
      actor: session.d.actor,
      content: [{ type: 'text', text: 'execute the queued research run' }],
    })
    await session.run({ until: 'turn-end', signal: new AbortController().signal })
    const status = await host.callService(
      { sessionId: session.key, extension: owner, service: 'research.multiagent.status', input: args },
      { kind: 'local' },
    )
    expect(
      status.output,
      JSON.stringify(await session.scan({ type: 'tool/result', toSeq: session.lastSeq })),
    ).toMatchObject({ status: 'completed', report: { status: 'unknown', issued_by: 'harness' } })
    const result = status.output as { artifacts: unknown[]; attempts: Array<{ status: string }> }
    expect(result.artifacts).toHaveLength(3)
    expect(result.attempts.map((attempt) => attempt.status)).toEqual(['completed', 'completed', 'completed'])
    const ledger = await session.scan({ toSeq: session.lastSeq })
    expect(ledger.some((event) => event.type.endsWith('/run-finished'))).toBe(true)
    const children = await (host.kernel.o.storage as unknown as ChildControlStore).listByParent(session.key)
    expect(children).toHaveLength(3)
    expect(children?.find((child) => child.inputText.includes('"role":"reviewer"'))?.toolAccess).toBe('none')
    await session.close()
  } finally {
    await host.close()
    await rm(dataDir, { recursive: true, force: true })
  }
})
