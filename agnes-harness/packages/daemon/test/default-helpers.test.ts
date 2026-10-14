import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPackageManager, parseSource, readLock, writeLock } from '@agnes/package-manager'
import { afterEach, expect, it, vi } from 'vitest'
import { activateDefaultHelpers, initializeDefaultHelpers } from '../src/packages/default-helpers.js'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'agh-default-helpers-'))
  roots.push(root)
  const profileDir = join(root, 'profiles', 'local-dev')
  mkdirSync(profileDir, { recursive: true })
  const exec = vi.fn(async () => {
    throw new Error('Network forbidden')
  })
  const manager = createPackageManager({
    dataDir: root,
    cwd: root,
    agnesVersion: '0.0.0',
    exec,
    references: async () => [],
  })
  const initializePolicy = async () => {
    const current = readLock(profileDir, { profile: 'local-dev', agnesVersion: '0.0.0' })
    writeLock(profileDir, {
      ...current,
      resolvedProfileHash: `sha256-${'0'.repeat(64)}`,
      seams: Object.fromEntries(
        [
          'approval',
          'checkpoint',
          'ledger',
          'sandbox',
          'verifier',
          'repair',
          'artifacts',
          'principals',
          'platform',
          'harness',
        ].map((n) => [n, '@agnes/base']),
      ),
      policySnapshot: { capabilityCeiling: ['tools'], workspacePackages: 'require-project-trust' },
    })
  }
  return { root, profileDir, manager, exec, initializePolicy }
}
it('installs bundled release packages offline once and preserves disable/remove on subsequent starts', async () => {
  const s = setup()
  await initializeDefaultHelpers(s)
  expect(
    (await s.manager.inventory(s.profileDir)).packages.map((p) => [
      p.id,
      p.entry.state.enabled,
      !!p.entry.state.trusted,
    ]),
  ).toEqual([
    ['@agnes/agnes-science', true, true],
    ['@agnes/document-reader', true, true],
    ['@agnes/mcp-helper', true, true],
    ['@agnes/plugin-helper', true, true],
    ['@agnes/research-verifier', true, true],
    ['@agnes/skill-helper', true, true],
  ])
  const publish = vi.fn(async () => {})
  await activateDefaultHelpers({
    profileDir: s.profileDir,
    inventory: await s.manager.inventory(s.profileDir),
    previous: undefined,
    publish,
  })
  expect(publish).toHaveBeenCalledOnce()
  await s.manager.setEnabled(s.profileDir, '@agnes/mcp-helper', false)
  await s.manager.setEnabled(s.profileDir, '@agnes/skill-helper', false)
  await s.manager.remove(s.profileDir, '@agnes/skill-helper')
  await initializeDefaultHelpers(s)
  expect(
    (await s.manager.inventory(s.profileDir)).packages.map((p) => [p.id, p.entry.state.enabled]),
  ).toEqual([
    ['@agnes/agnes-science', true],
    ['@agnes/document-reader', true],
    ['@agnes/mcp-helper', false],
    ['@agnes/plugin-helper', true],
    ['@agnes/research-verifier', true],
  ])
  expect(s.exec).not.toHaveBeenCalled()
}, 60_000)
it('provisions old profiles and rejects damaged initialization records', async () => {
  const s = setup()
  await s.initializePolicy()
  await initializeDefaultHelpers(s)
  expect((await s.manager.inventory(s.profileDir)).packages).toHaveLength(6)
  writeFileSync(join(s.profileDir, 'default-helpers', 'state.json'), '{}')
  await expect(initializeDefaultHelpers(s)).rejects.toThrow('Invalid helper initialization')
}, 60_000)
it('resumes interrupted first initialization without replacing already installed packages', async () => {
  const s = setup()
  const trust = s.manager.trust.bind(s.manager)
  const spy = vi
    .spyOn(s.manager, 'trust')
    .mockRejectedValueOnce(new Error('interrupted'))
    .mockImplementation(trust)
  await expect(initializeDefaultHelpers(s)).rejects.toThrow('interrupted')
  expect((await s.manager.inventory(s.profileDir)).packages).toHaveLength(1)
  await initializeDefaultHelpers(s)
  expect((await s.manager.inventory(s.profileDir)).packages.every((p) => p.entry.state.enabled)).toBe(true)
  expect(JSON.parse(readFileSync(join(s.profileDir, 'default-helpers', 'state.json'), 'utf8')).phase).toBe(
    'installed',
  )
  spy.mockRestore()
}, 60_000)
it.each(['@agnes/skill-helper', '@agnes/agnes-science', '@agnes/research-verifier'])(
  'does not trust an interrupted initialization with changed release hashes for %s',
  async (id) => {
    const s = setup()
    const spy = vi.spyOn(s.manager, 'trust').mockRejectedValueOnce(new Error('interrupted'))
    await expect(initializeDefaultHelpers(s)).rejects.toThrow('interrupted')
    spy.mockRestore()
    const file = join(s.profileDir, 'default-helpers', 'state.json')
    const state = JSON.parse(readFileSync(file, 'utf8'))
    state.integrity[id] = `sha256-${'0'.repeat(64)}`
    writeFileSync(file, JSON.stringify(state))
    await expect(initializeDefaultHelpers(s)).rejects.toThrow('verification failed')
    const changed = (await s.manager.inventory(s.profileDir)).packages.find((p) => p.id === id)
    expect(changed?.trusted ?? false).toBe(false)
  },
  60_000,
)

it.each([
  { enabled: true, version: 6 },
  { enabled: false, version: 6 },
  { enabled: true, version: 5 },
])(
  'resumes a stale receipt only from an already trusted snapshot (v$version, enabled=$enabled)',
  async ({ enabled, version }) => {
    const s = setup()
    await initializeDefaultHelpers(s)
    await s.manager.setEnabled(s.profileDir, '@agnes/agnes-science', enabled)
    const file = join(s.profileDir, 'default-helpers', 'state.json')
    const state = JSON.parse(readFileSync(file, 'utf8'))
    const inventory = await s.manager.inventory(s.profileDir)
    const science = inventory.packages.find((p) => p.id === '@agnes/agnes-science')
    if (!science) throw new Error('Science helper was not installed')
    state.version = version
    state.phase = 'pending'
    state.integrity = {
      '@agnes/agnes-science': `sha256-${'0'.repeat(64)}`,
      '@agnes/research-verifier':
        version === 5 ? `sha256-${'0'.repeat(64)}` : state.integrity['@agnes/research-verifier'],
    }
    writeFileSync(file, JSON.stringify(state))

    await initializeDefaultHelpers(s)
    const resumed = await s.manager.inventory(s.profileDir)
    expect(resumed.packages.find((p) => p.id === science.id)).toMatchObject({
      trusted: true,
      enabled,
      entry: { integrity: science.entry.integrity },
    })
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({
      version: 8,
      phase: 'installed',
      integrity: { '@agnes/agnes-science': science.entry.integrity },
    })
    const publish = vi.fn(async () => {})
    await activateDefaultHelpers({
      profileDir: s.profileDir,
      inventory: resumed,
      previous: undefined,
      publish,
    })
    expect(publish).toHaveBeenCalledOnce()
    expect(JSON.parse(readFileSync(file, 'utf8')).phase).toBe('complete')
    expect(s.exec).not.toHaveBeenCalled()
  },
  60_000,
)

it('bumps a completed v6 receipt to v7 without touching installed packages', async () => {
  const s = setup()
  await initializeDefaultHelpers(s)
  await activateDefaultHelpers({
    profileDir: s.profileDir,
    inventory: await s.manager.inventory(s.profileDir),
    previous: undefined,
    publish: async () => {},
  })
  const before = await s.manager.inventory(s.profileDir)
  const file = join(s.profileDir, 'default-helpers', 'state.json')
  const state = JSON.parse(readFileSync(file, 'utf8'))
  writeFileSync(file, JSON.stringify({ ...state, version: 6 }))
  await initializeDefaultHelpers(s)
  expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ version: 8, phase: 'complete' })
  expect(await s.manager.inventory(s.profileDir)).toEqual(before)
  expect(s.exec).not.toHaveBeenCalled()
}, 60_000)

it('migrates a v6 receipt without reinstalling an explicitly removed verifier', async () => {
  const s = setup()
  await initializeDefaultHelpers(s)
  await activateDefaultHelpers({
    profileDir: s.profileDir,
    inventory: await s.manager.inventory(s.profileDir),
    previous: undefined,
    publish: async () => {},
  })
  await s.manager.remove(s.profileDir, '@agnes/research-verifier')
  const file = join(s.profileDir, 'default-helpers', 'state.json')
  const state = JSON.parse(readFileSync(file, 'utf8'))
  delete state.integrity['@agnes/research-verifier']
  writeFileSync(file, JSON.stringify({ ...state, version: 6, phase: 'complete' }))
  await initializeDefaultHelpers(s)
  const migrated = JSON.parse(readFileSync(file, 'utf8'))
  expect(migrated.version).toBe(8)
  expect(migrated.phase).toBe('complete')
  expect(Object.hasOwn(migrated.integrity, '@agnes/research-verifier')).toBe(false)
  expect((await s.manager.inventory(s.profileDir)).packages.map((p) => p.id)).not.toContain(
    '@agnes/research-verifier',
  )
}, 60_000)

it('completes a pending receipt with disabled trusted packages without activating them', async () => {
  const s = setup()
  await initializeDefaultHelpers(s)
  const inventory = await s.manager.inventory(s.profileDir)
  for (const pkg of inventory.packages) await s.manager.setEnabled(s.profileDir, pkg.id, false)
  const file = join(s.profileDir, 'default-helpers', 'state.json')
  const state = JSON.parse(readFileSync(file, 'utf8'))
  writeFileSync(file, JSON.stringify({ ...state, phase: 'pending' }))
  await initializeDefaultHelpers(s)
  const publish = vi.fn(async () => {})
  await activateDefaultHelpers({
    profileDir: s.profileDir,
    inventory: await s.manager.inventory(s.profileDir),
    previous: undefined,
    publish,
  })
  expect(publish).not.toHaveBeenCalled()
  expect(JSON.parse(readFileSync(join(s.profileDir, 'default-helpers', 'state.json'), 'utf8')).phase).toBe(
    'complete',
  )
}, 60_000)

it('retries target publication after failure and never reactivates completed defaults', async () => {
  const s = setup()
  await initializeDefaultHelpers(s)
  const publish = vi.fn().mockRejectedValueOnce(new Error('probe failed')).mockResolvedValue(undefined)
  const options = {
    profileDir: s.profileDir,
    inventory: await s.manager.inventory(s.profileDir),
    previous: undefined,
    publish,
  }
  await expect(activateDefaultHelpers(options)).rejects.toThrow('probe failed')
  await initializeDefaultHelpers(s)
  await activateDefaultHelpers(options)
  await activateDefaultHelpers(options)
  expect(publish).toHaveBeenCalledTimes(2)
})

it('migrates the earlier existing marker without enabling or replacing an installed helper', async () => {
  const s = setup()
  await s.initializePolicy()
  const source = parseSource('file:./bundled-plugins/skill-helper')
  const preview = await s.manager.inspect(s.profileDir, source)
  await s.manager.install(s.profileDir, source, { expectedIntegrity: preview.integrity })
  const before = (await s.manager.inventory(s.profileDir)).packages.find(
    (p) => p.id === '@agnes/skill-helper',
  )
  mkdirSync(join(s.profileDir, 'default-helpers'))
  writeFileSync(
    join(s.profileDir, 'default-helpers', 'state.json'),
    JSON.stringify({ version: 1, phase: 'existing', integrity: {} }),
  )
  await initializeDefaultHelpers(s)
  const inventory = await s.manager.inventory(s.profileDir)
  expect(inventory.packages.find((p) => p.id === '@agnes/skill-helper')).toEqual(before)
  expect(inventory.packages.find((p) => p.id === '@agnes/mcp-helper')?.entry.state).toMatchObject({
    enabled: true,
  })
  const publish = vi.fn(async () => {})
  await activateDefaultHelpers({ profileDir: s.profileDir, inventory, previous: undefined, publish })
  expect(publish).toHaveBeenCalledOnce()
  await s.manager.setEnabled(s.profileDir, '@agnes/mcp-helper', false)
  await s.manager.remove(s.profileDir, '@agnes/mcp-helper')
  await initializeDefaultHelpers(s)
  expect((await s.manager.inventory(s.profileDir)).packages).toHaveLength(5)
}, 60_000)
it('records completion without activation when all helpers are already installed', async () => {
  const s = setup()
  await s.initializePolicy()
  for (const name of [
    'skill-helper',
    'mcp-helper',
    'plugin-helper',
    'document-reader',
    'agnes-science',
    'research-verifier',
  ]) {
    const source = parseSource(`file:./bundled-plugins/${name}`)
    const preview = await s.manager.inspect(s.profileDir, source)
    await s.manager.install(s.profileDir, source, { expectedIntegrity: preview.integrity })
  }
  const before = await s.manager.inventory(s.profileDir)
  await initializeDefaultHelpers(s)
  expect(await s.manager.inventory(s.profileDir)).toEqual(before)
  const publish = vi.fn(async () => {})
  await activateDefaultHelpers({ profileDir: s.profileDir, inventory: before, previous: undefined, publish })
  expect(publish).not.toHaveBeenCalled()
  await initializeDefaultHelpers(s)
  expect(JSON.parse(readFileSync(join(s.profileDir, 'default-helpers', 'state.json'), 'utf8')).phase).toBe(
    'complete',
  )
})

it.each([1, 2])(
  'migrates a completed v%s profile by adding new helpers, preserving prior removals',
  async (version) => {
    const s = setup()
    await s.initializePolicy()
    mkdirSync(join(s.profileDir, 'default-helpers'))
    writeFileSync(
      join(s.profileDir, 'default-helpers', 'state.json'),
      JSON.stringify({ version, phase: 'complete', integrity: {} }),
    )
    await initializeDefaultHelpers(s)
    expect((await s.manager.inventory(s.profileDir)).packages.map((p) => p.id)).toEqual(
      version === 1
        ? ['@agnes/agnes-science', '@agnes/document-reader', '@agnes/plugin-helper']
        : ['@agnes/agnes-science', '@agnes/document-reader'],
    )
    await activateDefaultHelpers({
      profileDir: s.profileDir,
      inventory: await s.manager.inventory(s.profileDir),
      previous: undefined,
      publish: async () => {},
    })
    expect(
      JSON.parse(readFileSync(join(s.profileDir, 'default-helpers', 'state.json'), 'utf8')).version,
    ).toBe(8)
    for (const pkg of (await s.manager.inventory(s.profileDir)).packages) {
      await s.manager.setEnabled(s.profileDir, pkg.id, false)
      await s.manager.remove(s.profileDir, pkg.id)
    }
    await initializeDefaultHelpers(s)
    expect((await s.manager.inventory(s.profileDir)).packages).toHaveLength(0)
  },
)
