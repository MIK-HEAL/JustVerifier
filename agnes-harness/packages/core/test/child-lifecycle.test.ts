import type { ModelRecord } from '@agnes/protocol'
import { Type } from '@sinclair/typebox'
import { describe, expect, it, vi } from 'vitest'
import { CHILD_CONTROL_FORMAT } from '../src/child/types.js'
import { Kernel } from '../src/kernel.js'
import { MemoryStorage } from '../src/log/memory-storage.js'
import { presetDefaults } from '../src/step/preset.js'
import { CoreError } from '../src/types.js'
import { fakeProvider, textTurn, toolTurn } from './helpers/fake-provider.js'

const catalogue = (): ModelRecord => ({
  id: 'm1',
  name: 'm1',
  api: 'openai-completions',
  route: 'default',
  baseUrl: 'https://example.invalid/v1',
  reasoning: false,
  input: ['text'],
  cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 8192,
  maxTokens: 128,
  toolCallFormats: ['native'],
  thinkingReplay: 'native',
  contract_id: null,
})

import { fakeSeams } from './helpers/fake-seams.js'
import { actor, noTimers, testFsOps } from './helpers/open-session.js'

const logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

function kernel(
  over: Partial<Parameters<typeof Kernel.create>[0]> & { treeBudgetCredits?: number | null } = {},
) {
  const { treeBudgetCredits = 100, ...rest } = over
  return Kernel.create({
    storage: new MemoryStorage(),
    seams: fakeSeams(),
    provider: Object.assign(fakeProvider([textTurn('child says hi'), textTurn('second')]), {
      models: () => [catalogue()],
    }),
    contract: { contract_id: null, parser_version: '1' },
    preset: { ...presetDefaults(), treeBudgetCredits, generationLimit: 1, maxFanOut: 2 },
    fsOps: testFsOps(),
    netFetch: async () => new Response(''),
    logger,
    timers: noTimers,
    clock: () => 1_757_203_200_000,
    ...rest,
  })
}

const sessionOpts = { actor, resolvedProfileHash: 'h1', cwd: '/w', writerRunId: 'r1' }

describe('Kernel child lifecycle (generation, fan-out, budget)', () => {
  it('denies every tool in restricted reviewers and retains the restriction on direct reopen', async () => {
    const provider = fakeProvider([toolTurn('mutate', {}), textTurn('review complete')])
    const k = kernel({
      provider,
      preset: { ...presetDefaults(), treeBudgetCredits: 100, generationLimit: 2, maxFanOut: 4 },
    })
    let mutations = 0
    k.tools.add(
      {
        name: 'mutate',
        description: 'mutate workspace',
        parameters: Type.Object({}),
        meta: {
          isReadOnly: false,
          isDestructive: false,
          isConcurrencySafe: false,
          isOpenWorld: false,
          replay: 'never',
          costHint: undefined,
          deferLoading: false,
          requiresApproval: 'never',
        },
        execute: async () => {
          mutations++
          return { content: [{ type: 'text', text: 'mutated' }] }
        },
      },
      { source: 'test', trust: 'builtin' },
    )
    const parent = await k.session('review-parent', sessionOpts)
    const child = await parent.d.children.create({
      parent: parent.key,
      cwd: '/w',
      input: 'review',
      toolAccess: 'none',
    })
    await child.run('review')
    expect(mutations).toBe(0)
    expect(provider.requests.every((request) => request.tools.length === 0)).toBe(true)
    expect(await (k.o.storage as MemoryStorage).lookupByKey(child.key)).toMatchObject({ toolAccess: 'none' })
    await k.get(child.key)?.close()
    const reopened = await k.session(child.key, { ...sessionOpts, writerRunId: 'review-reopen' })
    expect(reopened.d.toolAccess).toBe('none')
    const nested = await reopened.d.children.create({ parent: reopened.key, cwd: '/w', input: 'nested' })
    expect(k.get(nested.key)?.d.toolAccess).toBe('none')
    await k.close()
  })
  it('refuses a child when generationLimit is 0 and does not start a model', async () => {
    const provider = fakeProvider([textTurn('should not run')])
    const k = kernel({
      provider,
      preset: { ...presetDefaults(), treeBudgetCredits: 100, generationLimit: 0, maxFanOut: 4 },
    })
    const parent = await k.session('parent', sessionOpts)
    const calls = provider.requests?.length ?? 0
    await expect(
      parent.d.children.create({ parent: parent.key, cwd: '/w', input: 'nope' }),
    ).rejects.toMatchObject({ code: 'E_CHILD_LIMIT' })
    expect(provider.requests?.length ?? 0).toBe(calls)
    expect(k.sessions.size).toBe(1)
    await k.close()
  })

  it('admits one generation and refuses a grandchild even if tool nesting depth is 0', async () => {
    const k = kernel({
      preset: { ...presetDefaults(), treeBudgetCredits: 100, generationLimit: 1, maxFanOut: 4 },
    })
    const parent = await k.session('parent', sessionOpts)
    const child = await parent.d.children.create({ parent: parent.key, cwd: '/w', input: 'first' })
    const childSession = k.get(child.key)
    expect(childSession?.generationDepth).toBe(1)
    await expect(
      childSession?.d.children.create({ parent: child.key, cwd: '/w', input: 'grand' }),
    ).rejects.toMatchObject({ code: 'E_CHILD_LIMIT' })
    await child.run('first')
    await k.close()
  })

  it('counts creating and running children toward fan-out and frees the slot on terminal without collect', async () => {
    const k = kernel({
      preset: { ...presetDefaults(), treeBudgetCredits: 100, generationLimit: 2, maxFanOut: 1 },
    })
    const parent = await k.session('parent', sessionOpts)
    const first = await parent.d.children.create({ parent: parent.key, cwd: '/w', input: 'one' })
    await expect(
      parent.d.children.create({ parent: parent.key, cwd: '/w', input: 'two' }),
    ).rejects.toMatchObject({ code: 'E_CHILD_LIMIT' })
    await first.run('one')
    const second = await parent.d.children.create({ parent: parent.key, cwd: '/w', input: 'two' })
    expect(second.key).not.toBe(first.key)
    await k.close()
  })

  it('delegates with a built-in default tree budget when tree_budget_credits is missing', async () => {
    // Every shipped preset left this unset, which used to refuse every fork/spawn outright — a
    // missing knob, not a deliberate "no subagents" decision. The factory falls back to
    // DEFAULT_TREE_BUDGET_CREDITS instead of throwing E_BUDGET.
    const k = kernel({
      preset: { ...presetDefaults(), treeBudgetCredits: null, generationLimit: 2, maxFanOut: 4 },
    })
    const parent = await k.session('parent', sessionOpts)
    const child = await parent.d.children.create({ parent: parent.key, cwd: '/w', input: 'x' })
    expect(child.key).toBeDefined()
    await k.close()
  })

  it('refuses own budget inherit mode', async () => {
    const k = kernel({
      preset: {
        ...presetDefaults(),
        treeBudgetCredits: 100,
        budgetInherit: 'own',
        generationLimit: 2,
        maxFanOut: 4,
      },
    })
    const parent = await k.session('parent', sessionOpts)
    await expect(
      parent.d.children.create({ parent: parent.key, cwd: '/w', input: 'x' }),
    ).rejects.toMatchObject({ code: 'E_UNSUPPORTED' })
    await k.close()
  })

  it('atomically admits only one of two overlapping reservations against a tree cap of 10', async () => {
    const storage = new MemoryStorage()
    await storage.ensureRootScope('root', 10_000_000n)
    const first = await storage.reserve({
      rootTaskId: 'root',
      scopeIds: ['root:root'],
      qMicro: 8_000_000n,
      effectId: 'a',
      requestHash: 'a',
      writerGeneration: 1,
    })
    const second = await storage.reserve({
      rootTaskId: 'root',
      scopeIds: ['root:root'],
      qMicro: 8_000_000n,
      effectId: 'b',
      requestHash: 'b',
      writerGeneration: 1,
    })
    expect(first).toEqual({ ok: true, permitId: 'p1', status: 'held', existing: false })
    expect(second).toMatchObject({ ok: false, reason: 'cap' })
  })

  it('inspect of an unknown key does not create a session or take a writer', async () => {
    const storage = new MemoryStorage()
    const open = vi.spyOn(storage, 'open')
    const k = kernel({ storage })
    const parent = await k.session('parent', sessionOpts)
    const inspect = parent.d.children.inspect
    expect(inspect).toBeTypeOf('function')
    await expect(inspect?.('missing-child')).resolves.toBeNull()
    expect(await storage.existsSession('missing-child')).toBe(false)
    expect(open).toHaveBeenCalledTimes(1)
    await k.close()
  })

  it('rejects a child-control format newer than this runtime', async () => {
    const storage = new MemoryStorage({ childControlFormat: CHILD_CONTROL_FORMAT + 1 })
    const k = kernel({ storage })
    const parent = await k.session('parent', sessionOpts)
    await expect(
      parent.d.children.create({ parent: parent.key, cwd: '/w', input: 'x' }),
    ).rejects.toMatchObject({ code: 'E_FORMAT' })
    await k.close()
  })

  it('keeps a durable child record after the in-memory handle is closed', async () => {
    const storage = new MemoryStorage()
    const k = kernel({ storage })
    const parent = await k.session('parent', sessionOpts)
    const child = await parent.d.children.create({ parent: parent.key, cwd: '/w', input: 'keep' })
    await child.run('keep')
    await child.close()
    const record = await storage.lookupByKey(child.key)
    expect(record?.state).toBe('completed')
    expect(await storage.existsSession(child.key)).toBe(true)
    await k.close()
  })
})

describe('CoreError', () => {
  it('is the class thrown for child limit failures', () => {
    expect(new CoreError('E_CHILD_LIMIT', 'x')).toBeInstanceOf(Error)
  })
})
