import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { checkServiceDef } from '@agnes/extension-api'
import { createPackageManager, parseSource } from '@agnes/package-manager'
import { build } from 'esbuild'
import { afterEach, expect, it } from 'vitest'
import { copyBundledPlugins } from '../tools/build-local.js'

const roots: string[] = []
type RunView = {
  run_id: string
  status: string
  attempts: Array<{ status: string; output_artifact_ids: readonly string[]; error?: { code?: string } }>
  report?: { status: string; issued_by: string }
}
type RunTool = {
  name: string
  execute: (input: unknown, context: unknown) => Promise<{ structured: RunView }>
}
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
it.each([
  { name: 'skill-helper', exportName: 'skillHelper', tools: 4 },
  { name: 'mcp-helper', exportName: 'mcpHelper', tools: 1 },
  { name: 'plugin-helper', exportName: 'pluginHelper', tools: 3 },
  { name: 'document-reader', exportName: 'documentReader', tools: 1 },
])('ships and relocates $name outside source workspace', async (helper) => {
  const root = await mkdtemp(join(tmpdir(), 'agnes-helper-delivery-'))
  roots.push(root)
  const output = join(root, 'runtime')
  await copyBundledPlugins(output)
  expect((await readdir(join(output, 'bundled-plugins', helper.name))).sort()).toEqual(
    ['LICENSE', 'README.md', 'index.mjs', 'package.json', 'src'].sort(),
  )
  if (helper.name === 'document-reader') {
    const notices = await readdir(
      join(output, 'bundled-plugins', helper.name, 'src/runtime/THIRD-PARTY-NOTICES'),
    )
    expect(notices).toEqual(
      expect.arrayContaining([
        'saxes.txt',
        'pdfium-third-party.txt',
        'tesseract.txt',
        'leptonica.txt',
        'tessdata-Apache-2.0.txt',
      ]),
    )
  }
  const resolver = fileURLToPath(
    new URL('../../package-manager/src/bundled-plugin-source.ts', import.meta.url),
  )
  await build({
    stdin: {
      contents: `import { bundledPluginSourceRoot, BUNDLED_HELPERS } from ${JSON.stringify(resolver)}; import { readFileSync } from 'node:fs'; import { join } from 'node:path'; import { pathToFileURL } from 'node:url'; const tools = []; (await import(pathToFileURL(join(bundledPluginSourceRoot(BUNDLED_HELPERS.find(h=>h.name===${JSON.stringify(helper.name)}).ref), 'bundled-plugins/'+${JSON.stringify(helper.name)}+'/index.mjs')).href))[${JSON.stringify(helper.exportName)}].apply({effect: factory => factory(), extension:()=>({registerTool: tool => tools.push(tool.name)})}); if (tools.length !== ${helper.tools}) throw new Error('Missing tools'); console.log(JSON.parse(readFileSync(join(bundledPluginSourceRoot(BUNDLED_HELPERS.find(h=>h.name===${JSON.stringify(helper.name)}).ref), 'bundled-plugins/'+${JSON.stringify(helper.name)}+'/package.json'), 'utf8')).name)`,
      resolveDir: root,
    },
    outfile: join(output, 'probe.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    define: { AGNES_PACKAGED_BUILTINS: 'true' },
  })
  const relocated = join(root, 'relocated-runtime')
  await rename(output, relocated)
  expect(
    execFileSync(process.execPath, [join(relocated, 'probe.mjs')], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    }).trim(),
  ).toBe(`@agnes/${helper.name}`)
  // A missing sidecar must not fall back to a same-named folder in the user's cwd.
  const impostor = join(root, 'bundled-plugins', helper.name)
  await mkdir(impostor, { recursive: true })
  await writeFile(join(impostor, 'package.json'), JSON.stringify({ name: 'impostor' }))
  await rename(join(relocated, 'bundled-plugins'), join(relocated, 'payload-backup'))
  expect(() =>
    execFileSync(process.execPath, [join(relocated, 'probe.mjs')], {
      cwd: root,
      windowsHide: true,
      stdio: 'pipe',
    }),
  ).toThrow()
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  expect(pkg.files).toEqual(
    expect.arrayContaining(['dist/local/bundled-plugins', 'dist/sea/bundled-plugins']),
  )
  expect(await readFile(new URL('../sea/build.mjs', import.meta.url), 'utf8')).toContain("'bundled-plugins'")
})

it('ships the bundled scientific tools with their Skill support files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agnes-agnes-science-delivery-'))
  roots.push(root)
  const output = join(root, 'runtime')
  await copyBundledPlugins(output)
  const packageRoot = join(output, 'bundled-plugins', 'agnes-science')
  expect(JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))).toMatchObject({
    name: '@agnes/agnes-science',
    version: '0.35.3',
    exports: './index.mjs',
  })
  expect((await readdir(join(packageRoot, 'skills'))).length).toBeGreaterThanOrEqual(20)
  expect(await readFile(join(packageRoot, 'src', 'core.mjs'), 'utf8')).toContain('write_artifact_file')
  expect(await readFile(join(packageRoot, 'src', 'notebook.mjs'), 'utf8')).toContain('notebook_execute')
  const descriptor = JSON.parse(
    await readFile(join(packageRoot, 'extensions/main/agnes.client.json'), 'utf8'),
  )
  expect(descriptor.client.services).toContain('science.library.file')
  const clientBuild = await build({
    entryPoints: [join(packageRoot, 'extensions/main/client/index.js')],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    write: false,
    external: ['react', '@agnes/web-ui/assistant-ui'],
  })
  expect(clientBuild.outputFiles).toHaveLength(1)
  expect(clientBuild.outputFiles[0]?.text).toContain('science.library.enqueue')
  expect(existsSync(join(packageRoot, 'mcp'))).toBe(false)
})

it('ships the research-verifier client extension into local builds', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agnes-research-verifier-delivery-'))
  roots.push(root)
  const output = join(root, 'runtime')
  await copyBundledPlugins(output)

  const packageRoot = join(output, 'bundled-plugins', 'research-verifier')
  const clientRoot = join(packageRoot, 'extensions', 'main', 'client')
  expect(await readFile(join(packageRoot, 'src/verifier.mjs'), 'utf8')).toBe(
    await readFile(
      new URL('../../package-manager/bundled-plugins/research-verifier/src/verifier.mjs', import.meta.url),
      'utf8',
    ),
  )
  const clientBuild = await build({
    entryPoints: [join(clientRoot, 'index.js')],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    write: false,
    external: ['react'],
  })
  expect(clientBuild.outputFiles).toHaveLength(1)
  const descriptor = JSON.parse(
    await readFile(join(packageRoot, 'extensions', 'main', 'agnes.client.json'), 'utf8'),
  ) as { client?: { entry?: string; styles?: string[]; services?: string[]; slots?: string[] } }

  expect(descriptor.client).toMatchObject({
    entry: './client/index.js',
    styles: ['./client/index.css'],
    slots: ['sidebar.footer.action', 'workbench.panel'],
    services: [
      'research.multiagent.start',
      'research.multiagent.direct',
      'research.multiagent.status',
      'research.multiagent.cancel',
    ],
  })
  expect((await readdir(clientRoot)).sort()).toEqual([
    'agent-palette.js',
    'agents.js',
    'canvas.js',
    'entry.js',
    'events.js',
    'index.css',
    'index.js',
    'inspector.js',
    'node-actions.js',
    'plan.js',
    'use-verification-run.js',
    'workbench.js',
  ])
  const manager = createPackageManager({
    dataDir: root,
    cwd: root,
    agnesVersion: '0.0.0',
    references: async () => [],
  })
  const preview = await manager.inspect(
    join(root, 'profiles', 'local-dev'),
    parseSource('file:./runtime/bundled-plugins/research-verifier'),
  )
  expect(preview.blockers).toEqual([])
  expect(preview.contributions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: 'client',
        rowId: 'ext:research-verifier/main',
        client: expect.objectContaining({
          slots: ['sidebar.footer.action', 'workbench.panel'],
          services: [
            'research.multiagent.cancel',
            'research.multiagent.direct',
            'research.multiagent.start',
            'research.multiagent.status',
          ],
        }),
      }),
    ]),
  )
  const plan = (await import(pathToFileURL(join(clientRoot, 'plan.js')).href)) as {
    validateGraph: (
      nodes: Array<{ id: string; role: string }>,
      edges: Array<{ from: string; to: string }>,
    ) => string[]
    graphPlan: (
      nodes: Array<{ id: string; role: string }>,
      edges: Array<{ from: string; to: string }>,
    ) => {
      root_agent_id: string
      agents: Array<{ agent_id: string }>
      tasks: Array<{ task_id: string; depends_on?: string[] }>
    }
    digest: (value: unknown) => Promise<string>
  }
  expect(plan.validateGraph([], [])).toEqual(['至少拖入一个 Agent', '需要一个规划 Agent 作为根节点'])
  const planner = { id: 'planner-1', role: 'planner', label: '规划 Agent', prompt: '', x: 0, y: 0 }
  const executor = { id: 'executor-1', role: 'executor', label: '执行 Agent', prompt: '', x: 0, y: 0 }
  expect(plan.validateGraph([planner], [])).toEqual([])
  expect(plan.validateGraph([planner], [{ from: 'planner-1', to: 'planner-1' }])).toEqual([
    '不能连接节点自身',
    '编排图存在循环依赖',
  ])
  expect(
    plan.validateGraph(
      [planner, executor],
      [
        { from: 'planner-1', to: 'executor-1' },
        { from: 'executor-1', to: 'planner-1' },
      ],
    ),
  ).toEqual(['编排图存在循环依赖'])
  const built = plan.graphPlan([planner, executor], [{ from: 'planner-1', to: 'executor-1' }])
  expect(built.root_agent_id).toBe('planner-1')
  expect(built.agents.map((agent) => agent.agent_id)).toEqual(['planner-1', 'executor-1'])
  expect(built.tasks.find((task) => task.task_id === 'task-executor-1')).toMatchObject({
    depends_on: ['task-planner-1'],
  })
  const checksum = await plan.digest(built)
  expect(checksum).toMatch(/^sha256:[0-9a-f]{64}$/)
  expect(await plan.digest(built)).toBe(checksum)
  const { researchVerifier } = await import(pathToFileURL(join(packageRoot, 'index.mjs')).href)
  const services: unknown[] = []
  const tools: RunTool[] = []
  const events: unknown[] = []
  researchVerifier.apply({
    services: { register: (service: unknown) => services.push(service) },
    extension: () => ({
      registerTool: (tool: RunTool) => tools.push(tool),
      events: {
        append: async (...args: unknown[]) => {
          events.push(args)
        },
      },
    }),
  })
  expect(services).toHaveLength(4)
  expect(services[0]).toMatchObject({ name: 'research.multiagent.start' })
  expect(services[1]).toMatchObject({ name: 'research.multiagent.direct' })
  expect(checkServiceDef(services[0])).toEqual({ ok: true })
  expect(checkServiceDef(services[1])).toEqual({ ok: true })
  const start = services[0] as {
    handler: (input: unknown, context?: unknown) => Promise<RunView>
  }
  const direct = services[1] as typeof start
  const status = services[2] as typeof start
  const cancel = services[3] as typeof start
  const session = { sessionId: 'research-session' }
  const signed = { ...built, checksum }
  const accepted = await start.handler({ prompt: 'verify the research', plan: signed }, session)
  expect(accepted).toMatchObject({
    status: 'queued',
    plan_checksum: checksum,
  })
  for (const invalid of [
    { ...signed, checksum: `sha256:${'0'.repeat(64)}` },
    { ...signed, tasks: [] },
    { ...signed, schema_version: 2 },
    { ...signed, tasks: [{ ...built.tasks[0], output_namespace: 'planner-1/../other' }] },
    { ...signed, tasks: [{ ...built.tasks[0], budget: { timeout_ms: -1 } }] },
    { ...signed, tasks: [{ ...built.tasks[0], input_artifact_ids: 42 }] },
    { ...signed, agents: [{ agent_id: 'planner-1', role: 'unsupported' }] },
  ])
    await expect(start.handler({ prompt: 'verify', plan: invalid })).rejects.toMatchObject({
      code: 'INVALID_MULTI_AGENT_PLAN',
    })
  expect(await status.handler({ run_id: accepted.run_id }, { sessionId: 'other-session' })).toMatchObject({
    status: 'unknown',
    reason: 'RUN_NOT_FOUND_OR_RECOVERY_REQUIRED',
    attempts: [],
  })
  await expect(start.handler({ prompt: 'verify', plan: signed }, session)).rejects.toMatchObject({
    code: 'RUN_BUSY',
  })
  const bytes = new Map<string, Uint8Array>()
  const children: string[] = []
  const context = {
    session: { key: session.sessionId },
    signal: new AbortController().signal,
    subagent: {
      capabilities: { toolAccess: 'none' },
      spawn: async (text: string) => {
        children.push(text)
        return { childKey: `child-${children.length}` }
      },
      collect: async () => ({ status: 'completed', text: 'observation' }),
      cancel: async () => ({ status: 'cancelled' }),
    },
    artifacts: {
      put: async (value: Uint8Array) => {
        const ref = `ref-${bytes.size}`
        bytes.set(ref, value)
        return ref
      },
      get: async (ref: string) => bytes.get(ref),
    },
  }
  const execute = tools.find((tool) => tool.name === 'research_multiagent_run')
  if (!execute) throw new Error('missing research runner tool')
  const completed = await execute.execute({ run_id: accepted.run_id }, context)
  expect(completed.structured).toMatchObject({
    status: 'completed',
    report: { status: 'unknown', issued_by: 'harness' },
  })
  expect(completed.structured.attempts.map((attempt) => attempt.status)).toEqual(['completed', 'completed'])
  expect(JSON.parse(children[1] ?? '{}').evidence[0].text).toBe('observation')
  expect(events.length).toBeGreaterThan(0)
  await execute.execute({ run_id: accepted.run_id }, context)
  expect(children).toHaveLength(2)
  const resumable = await direct.handler(
    { prompt: 'verify', agent_id: 'executor-resumable', role: 'executor' },
    session,
  )
  let resumableCollects = 0
  const resumableCancels: string[] = []
  const first = await execute.execute(
    { run_id: resumable.run_id },
    {
      ...context,
      subagent: {
        ...context.subagent,
        collect: async () =>
          ++resumableCollects === 1
            ? { status: 'running', waitTimedOut: true }
            : { status: 'completed', text: 'eventual observation' },
        cancel: async (childKey: string) => {
          resumableCancels.push(childKey)
          return { status: 'cancelled' }
        },
      },
    },
  )
  expect(first.structured).toMatchObject({
    status: 'running',
    attempts: [{ status: 'running' }],
  })
  expect(resumableCancels).toEqual([])
  const resumed = await execute.execute(
    { run_id: resumable.run_id },
    {
      ...context,
      subagent: {
        ...context.subagent,
        collect: async () => ({ status: 'completed', text: 'eventual observation' }),
      },
    },
  )
  expect(resumed.structured).toMatchObject({ status: 'completed' })
  expect(resumed.structured.attempts[0]?.error?.code).toBeUndefined()
  const review = await direct.handler({ prompt: 'verify', agent_id: 'reviewer-1', role: 'reviewer' }, session)
  expect(review).toMatchObject({ status: 'queued' })
  let reviewerOptions: unknown
  context.subagent.spawn = async (_text: string, options?: unknown) => {
    reviewerOptions = options
    return { childKey: 'reviewer' }
  }
  expect((await execute.execute({ run_id: review.run_id }, context)).structured.status).toBe('completed')
  expect(reviewerOptions).toMatchObject({ toolAccess: 'none' })
  const queued = await direct.handler({ prompt: 'verify', agent_id: 'reviewer-1', role: 'reviewer' }, session)
  expect(await cancel.handler({ run_id: queued.run_id }, session)).toMatchObject({ status: 'cancelled' })
  expect((await execute.execute({ run_id: queued.run_id }, context)).structured.status).toBe('cancelled')
  const unavailable = await direct.handler(
    { prompt: 'verify', agent_id: 'reviewer-1', role: 'reviewer' },
    session,
  )
  const { capabilities: _, ...legacy } = context.subagent
  const refused = await execute.execute({ run_id: unavailable.run_id }, { ...context, subagent: legacy })
  expect(refused.structured.attempts[0]?.error?.code).toBe('REVIEWER_ISOLATION_UNAVAILABLE')
  let releaseSpawn: ((value: { childKey: string }) => void) | undefined
  let notifySpawn: (() => void) | undefined
  const spawned = new Promise<void>((resolve) => {
    notifySpawn = resolve
  })
  const cancellations: string[] = []
  const delayed = await direct.handler(
    { prompt: 'verify', agent_id: 'reviewer-1', role: 'reviewer' },
    session,
  )
  const inFlight = execute.execute(
    { run_id: delayed.run_id },
    {
      ...context,
      subagent: {
        ...context.subagent,
        spawn: async () => {
          notifySpawn?.()
          return new Promise((resolve) => {
            releaseSpawn = resolve
          })
        },
        cancel: async (childKey: string) => {
          cancellations.push(childKey)
          return { status: 'cancelled' }
        },
      },
    },
  )
  await spawned
  expect(await cancel.handler({ run_id: delayed.run_id }, session)).toMatchObject({ status: 'cancelling' })
  releaseSpawn?.({ childKey: 'late-child' })
  expect((await inFlight).structured).toMatchObject({ status: 'cancelled' })
  expect(cancellations).toContain('late-child')
  expect(
    (await status.handler({ run_id: delayed.run_id }, session)).attempts[0]?.output_artifact_ids,
  ).toEqual([])
  await expect(
    direct.handler({ prompt: 'verify', agent_id: 'reviewer-1', role: 'reviewer' }),
  ).rejects.toMatchObject({
    code: 'SESSION_REQUIRED',
  })
  await expect(
    direct.handler({ prompt: 'verify', agent_id: 'reviewer-1', role: 'unsupported' }),
  ).rejects.toMatchObject({ code: 'INVALID_AGENT_REQUEST' })
  const extraRoles = plan.graphPlan(
    [
      planner,
      { ...executor, id: 'agnes-1', role: 'agnes' },
      { ...executor, id: 'synthesizer-1', role: 'synthesizer' },
    ],
    [],
  )
  const extraChecksum = await plan.digest(extraRoles)
  expect(
    await start.handler({ prompt: 'verify', plan: { ...extraRoles, checksum: extraChecksum } }, session),
  ).toMatchObject({ status: 'queued' })
  expect(plan.validateGraph([planner, planner], [])).toContain('Agent 节点 ID 不能重复')
  const stuckSession = { sessionId: 'stuck-session' }
  const stuck = await direct.handler(
    { prompt: 'verify', agent_id: 'executor-1', role: 'executor' },
    stuckSession,
  )
  const stuckController = new AbortController()
  const unresolved = execute.execute(
    { run_id: stuck.run_id },
    {
      ...context,
      session: { key: stuckSession.sessionId },
      signal: stuckController.signal,
      timeoutMs: 5,
      subagent: {
        ...context.subagent,
        spawn: async () => {
          stuckController.abort()
          return new Promise(() => {})
        },
      },
    },
  )
  expect((await unresolved).structured).toMatchObject({ status: 'unknown' })
  await expect(
    direct.handler({ prompt: 'retry', agent_id: 'executor-1', role: 'executor' }, stuckSession),
  ).rejects.toMatchObject({ code: 'RUN_BUSY' })
})
