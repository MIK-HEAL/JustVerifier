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
  const root = await mkdtemp(join(tmpdir(), 'agnes-open-science-delivery-'))
  roots.push(root)
  const output = join(root, 'runtime')
  await copyBundledPlugins(output)
  const packageRoot = join(output, 'bundled-plugins', 'open-science')
  expect(JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))).toMatchObject({
    name: '@agnes/open-science',
    version: '0.35.2',
    exports: './index.mjs',
  })
  expect((await readdir(join(packageRoot, 'skills'))).length).toBeGreaterThanOrEqual(20)
  expect(await readFile(join(packageRoot, 'src', 'core.mjs'), 'utf8')).toContain('write_artifact_file')
  expect(await readFile(join(packageRoot, 'src', 'notebook.mjs'), 'utf8')).toContain('notebook_execute')
  expect(existsSync(join(packageRoot, 'mcp'))).toBe(false)
})

it('ships the research-verifier client extension into local builds', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agnes-research-verifier-delivery-'))
  roots.push(root)
  const output = join(root, 'runtime')
  await copyBundledPlugins(output)

  const packageRoot = join(output, 'bundled-plugins', 'research-verifier')
  const clientRoot = join(packageRoot, 'extensions', 'main', 'client')
  const descriptor = JSON.parse(
    await readFile(join(packageRoot, 'extensions', 'main', 'agnes.client.json'), 'utf8'),
  ) as { client?: { entry?: string; styles?: string[]; services?: string[]; slots?: string[] } }

  expect(descriptor.client).toMatchObject({
    entry: './client/index.js',
    styles: ['./client/index.css'],
    slots: ['sidebar.footer.action', 'workbench.panel', 'rightbar.session'],
    services: ['research.multiagent.start', 'research.multiagent.direct'],
  })
  expect((await readdir(clientRoot)).sort()).toEqual([
    'agent-palette.js',
    'agents.js',
    'canvas.js',
    'entry.js',
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
          slots: ['rightbar.session', 'sidebar.footer.action', 'workbench.panel'],
          services: ['research.multiagent.direct', 'research.multiagent.start'],
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
  researchVerifier.apply({
    services: { register: (service: unknown) => services.push(service) },
    extension: () => ({ registerTool() {} }),
  })
  expect(services).toHaveLength(2)
  expect(services[0]).toMatchObject({ name: 'research.multiagent.start' })
  expect(services[1]).toMatchObject({ name: 'research.multiagent.direct' })
  expect(checkServiceDef(services[0])).toEqual({ ok: true })
  expect(checkServiceDef(services[1])).toEqual({ ok: true })
})
