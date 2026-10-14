/** @vitest-environment happy-dom */
import { createHash, webcrypto } from 'node:crypto'
import { resolve } from 'node:path'
import { Context } from '@agnes/cordis'
import { SessionService, SlotRegistry } from '@agnes/web-client'
import { ScientificFilePreview } from '@agnes/web-ui/assistant-ui'
import { build } from 'esbuild'
import * as React from 'react'
import { act } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
// @ts-expect-error The delivered plugin intentionally ships plain JavaScript without declarations.
import { loadLibraryFile } from '../../package-manager/bundled-plugins/agnes-science/extensions/main/client/resources.js'
import { mountRightbarRegion } from '../src/region-slots.js'

const cleanup: (() => Promise<void>)[] = []
beforeEach(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
})
async function loadPlugin() {
  // The deployed client gets these same singletons from its browser import map.
  Reflect.set(globalThis, Symbol.for('agnes.science.test.vendors'), { React, ScientificFilePreview })
  const output = await build({
    entryPoints: [
      resolve('packages/package-manager/bundled-plugins/agnes-science/extensions/main/client/index.js'),
    ],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false,
    plugins: [
      {
        name: 'test-import-map',
        setup(builder) {
          builder.onResolve({ filter: /^(react|@agnes\/web-ui\/assistant-ui)$/ }, () => ({
            path: 'singletons',
            namespace: 'test-vendor',
          }))
          builder.onLoad({ filter: /.*/, namespace: 'test-vendor' }, () => ({
            contents: `const shared=globalThis[Symbol.for('agnes.science.test.vendors')]; export const {createElement,useEffect,useRef,useState}=shared.React; export const ScientificFilePreview=shared.ScientificFilePreview;`,
            loader: 'js',
          }))
        },
      },
    ],
  })
  return await import(
    `data:text/javascript;base64,${Buffer.from(output.outputFiles[0]?.text ?? '').toString('base64')}`
  )
}
afterEach(async () => {
  for (const off of cleanup.splice(0)) await act(async () => off())
  vi.restoreAllMocks()
  Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  Reflect.deleteProperty(globalThis, Symbol.for('agnes.science.test.vendors'))
  document.body.replaceChildren()
})

it('exposes a real rightbar library, filters literature, and sends immutable save operations through the session', async () => {
  const { apply } = await loadPlugin()
  const ctx = new Context()
  await ctx.plugin(SlotRegistry)
  const slots = (ctx as unknown as { slots: SlotRegistry }).slots
  const session = new SessionService(ctx, 'session-a')
  slots.bindSession(session)
  const records = [
    {
      id: 'paper',
      revision: 'rev',
      title: 'Water study',
      authors: ['Ada'],
      doi: '10.1234/water',
      year: '2026',
      journal: 'Science',
      url: '',
      tags: ['chemistry'],
      collection: 'Review',
      notes: '',
      files: [],
    },
  ]
  const prompt = vi.fn(async () => {
    const first = records[0]
    if (first) first.title = 'Edited title'
  })
  const call = vi.fn(async (name: string) => ({
    output: name === 'science.library.list' ? { records: structuredClone(records) } : { status: 'completed' },
  }))
  const execute = vi.fn(async () => ({ output: { operationId: 'operation-1' } }))
  const host = document.createElement('aside')
  host.id = 'rightbar-panel'
  host.dataset.agnesRegion = 'rightbar'
  document.body.append(host)
  let mount!: ReturnType<typeof mountRightbarRegion>
  await act(async () => {
    mount = mountRightbarRegion(slots, host, { session })
  })
  cleanup.push(async () => {
    mount.dispose()
    await ctx.fiber.dispose()
  })
  await act(async () =>
    apply({
      session: { ...session, sessionId: 'session-a', projection: session.projection, commands: { prompt } },
      slots,
      commands: { registerEffect: vi.fn(), execute },
      agnes: { services: { call } },
    }),
  )
  await vi.waitFor(() => expect(host.querySelector('[data-literature-library]')).toBeTruthy())
  await act(async () => {
    host.querySelector<HTMLButtonElement>('[data-literature-library] > button')?.click()
  })
  await vi.waitFor(() => expect(host.querySelector('.science-records')?.textContent).toContain('Water study'))
  await act(async () => {
    host.querySelector<HTMLButtonElement>('.science-records button')?.click()
  })
  const button = (label: string) =>
    Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === label)
  await act(async () => {
    button('编辑')?.click()
  })
  await act(async () => {
    const authors = host.querySelector<HTMLInputElement>('form label:nth-child(2) input')
    if (!authors) throw new Error('Missing authors field')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(authors, 'Ada; Grace')
    authors.dispatchEvent(new Event('input', { bubbles: true }))
    authors.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await act(async () => {
    host.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
  await vi.waitFor(() =>
    expect(execute).toHaveBeenCalledWith(
      'science.library.enqueue',
      expect.objectContaining({
        action: 'save',
        id: 'paper',
        revision: 'rev',
        record: expect.objectContaining({ authors: ['Ada', 'Grace'] }),
      }),
    ),
  )
  expect(prompt).toHaveBeenCalledWith([{ type: 'text', text: expect.stringContaining('operation-1') }])
  await vi.waitFor(() =>
    expect(host.querySelector('.science-records')?.textContent).toContain('Edited title'),
  )
  expect(host.textContent).toContain('已保存')
})

it('verifies preview bytes, refuses a stale session or bad hash, and releases delivered URLs', async () => {
  const bytes = Buffer.from('x,y\n1,2')
  const file = {
    version: 'v1',
    name: 'data.csv',
    mime: 'text/csv',
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
  const digest = webcrypto.subtle.digest.bind(webcrypto.subtle)
  vi.spyOn(crypto.subtle, 'digest').mockImplementation((_algorithm, data) =>
    digest(
      'SHA-256',
      new Uint8Array(
        ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : data,
      ),
    ),
  )
  const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:library-file')
  const revoked = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const session = { sessionId: 'session-a' }
  const call = vi.fn(async () => ({
    output: { file, offset: 0, nextOffset: bytes.length, base64: bytes.toString('base64') },
  }))
  const ctx = { session, agnes: { services: { call } } }
  const resource = await loadLibraryFile(ctx, 'paper', 'v1', new AbortController().signal)
  expect(resource.content).toBe(bytes.toString())
  resource.release()
  expect(revoked).toHaveBeenCalledWith('blob:library-file')
  call.mockImplementationOnce(async () => {
    session.sessionId = 'session-b'
    return { output: { file, offset: 0, nextOffset: bytes.length, base64: bytes.toString('base64') } }
  })
  await expect(loadLibraryFile(ctx, 'paper', 'v1', new AbortController().signal)).rejects.toThrow(
    '会话已切换',
  )
  call.mockResolvedValueOnce({
    output: {
      file: { ...file, sha256: 'a'.repeat(64) },
      offset: 0,
      nextOffset: bytes.length,
      base64: bytes.toString('base64'),
    },
  })
  await expect(loadLibraryFile(ctx, 'paper', 'v1', new AbortController().signal)).rejects.toThrow('校验失败')
  expect(created).toHaveBeenCalledTimes(1)
})
