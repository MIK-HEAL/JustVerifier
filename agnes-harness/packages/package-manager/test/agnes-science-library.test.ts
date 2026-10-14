import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { checkServiceDef } from '@agnes/extension-api'
import { afterEach, expect, it } from 'vitest'

const { LiteratureStore, readLibrary, registerLiterature } = await import(
  new URL('../bundled-plugins/agnes-science/src/literature-store.mjs', import.meta.url).href
)
const { exportCitations, importCsl } = await import(
  new URL('../bundled-plugins/agnes-science/src/citations.mjs', import.meta.url).href
)
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'science-library-'))
  roots.push(root)
  const context = {
    cwd: root,
    session: {
      key: 'session-a',
      readAttachment: async (_input: {
        path: string
        offset?: number
        limit?: number
        maxBytes?: number
      }): Promise<{ name: string; mimeType: string; bytes: Uint8Array } | undefined> => undefined,
    },
    sessionId: 'session-a',
    signal: new AbortController().signal,
    fs: {
      read: async (p: string) => new Uint8Array(await readFile(join(root, p))),
      write: async (p: string, bytes: string | Uint8Array) => {
        await mkdir(dirname(join(root, p)), { recursive: true })
        await writeFile(join(root, p), bytes)
      },
      list: async (p: string) =>
        (await readdir(join(root, p), { withFileTypes: true })).map((e) => ({
          name: e.name,
          kind: e.isFile() ? 'file' : 'dir',
        })),
      stat: async (p: string) => {
        const s = await stat(join(root, p))
        return { kind: s.isFile() ? 'file' : 'dir', size: s.size }
      },
    },
    artifacts: {
      put: async (bytes: Uint8Array, meta: { mime: string }) => ({
        sha256: createHash('sha256').update(bytes).digest('hex'),
        size: bytes.length,
        mime: meta.mime,
      }),
    },
  }
  return { root, context, store: new LiteratureStore() }
}
it('persists project metadata, normalizes DOI, rejects duplicates and stale edits after reload', async () => {
  const f = await fixture()
  expect(await readLibrary(f.context)).toEqual([])
  const first = (
    await f.store.mutate(
      {
        action: 'save',
        record: {
          title: ' Paper ',
          doi: 'https://doi.org/10.1234/ABC',
          authors: ['Ada'],
          tags: ['review', 'review'],
          collection: 'Project',
        },
      },
      f.context,
    )
  ).records[0]
  const reloaded = new LiteratureStore()
  expect(await readLibrary(f.context)).toMatchObject([
    { id: first.id, doi: '10.1234/abc', tags: ['review'], collection: 'Project' },
  ])
  await expect(
    reloaded.mutate({ action: 'save', record: { title: 'Duplicate', doi: '10.1234/abc' } }, f.context),
  ).rejects.toMatchObject({ code: 'LIBRARY_DUPLICATE_DOI' })
  const changed = (
    await reloaded.mutate(
      { action: 'save', id: first.id, revision: first.revision, record: { ...first, title: 'Changed' } },
      f.context,
    )
  ).records[0]
  await expect(
    f.store.mutate({ action: 'remove', id: first.id, revision: first.revision }, f.context),
  ).rejects.toMatchObject({ code: 'LIBRARY_STALE_REVISION' })
  await reloaded.mutate({ action: 'remove', id: changed.id, revision: changed.revision }, f.context)
  expect(await readLibrary(f.context)).toEqual([])
  expect((await readdir(join(f.root, '.agnes/science/library'))).length).toBe(3)
})
it('preserves old file bytes and identities, exports citation formats and bounds project preview chunks', async () => {
  const f = await fixture()
  type CapturedService = {
    name: string
    handler: (i: unknown, c: unknown) => Promise<Record<string, unknown>>
  }
  const services: Record<string, CapturedService> = {}
  registerLiterature(
    {
      extension: () => ({ registerTool: () => {} }),
      services: {
        register: (def: CapturedService) => {
          expect(checkServiceDef(def)).toEqual({ ok: true })
          services[def.name] = def
        },
      },
    },
    f.store,
  )
  let record = (
    await f.store.mutate(
      {
        action: 'save',
        record: {
          title: 'Dataset',
          authors: ['A {B}'],
          year: '2026',
          doi: '10.1234/data',
          journal: 'Journal',
        },
      },
      f.context,
    )
  ).records[0]
  await writeFile(join(f.root, 'data.csv'), 'x,y\n1,2')
  record = (
    await f.store.mutate(
      { action: 'attach', id: record.id, revision: record.revision, path: 'data.csv' },
      f.context,
    )
  ).records[0]
  const old = record.files[0]
  await writeFile(join(f.root, 'data.csv'), 'x,y\n3,4')
  record = (
    await f.store.mutate(
      { action: 'attach', id: record.id, revision: record.revision, path: 'data.csv', fileId: old.id },
      f.context,
    )
  ).records[0]
  expect(record.files).toHaveLength(2)
  expect(record.files[1].id).toBe(old.id)
  expect(record.files[1].version).not.toBe(old.version)
  const fileService = services['science.library.file']
  if (!fileService) throw new Error('Missing library file service')
  const read = await fileService.handler({ id: record.id, version: old.version, offset: 0 }, f.context)
  expect(Buffer.from(String(read.base64), 'base64').toString()).toBe('x,y\n1,2')
  expect((await fileService.handler({ id: record.id, version: '../other', offset: 0 }, f.context)).code).toBe(
    'LIBRARY_FILE_NOT_FOUND',
  )
  expect(exportCitations([record], 'bibtex').content).toContain('A \\{B\\}')
  expect(exportCitations([record], 'ris').content).toContain('DO  - 10.1234/data')
  expect(JSON.parse(exportCitations([record], 'csl').content)[0]['container-title']).toBe('Journal')
  expect(importCsl(exportCitations([record], 'csl').content)[0].doi).toBe(record.doi)
  await writeFile(join(f.root, `.agnes/science/files/${old.sha256}.bin`), 'tampered')
  expect(
    (await fileService.handler({ id: record.id, version: old.version, offset: 0 }, f.context)).code,
  ).toBe('LIBRARY_FILE_CORRUPT')
})
it('binds queued mutations to the trusted session/workspace and returns receipts only after durable writes', async () => {
  const f = await fixture()
  const op = f.store.enqueue({ action: 'save', record: { title: 'Queued' } }, f.context)
  await expect(
    f.store.consume(op.operationId, { ...f.context, sessionId: 'other', session: { key: 'other' } }),
  ).rejects.toMatchObject({ code: 'LIBRARY_OPERATION_UNKNOWN' })
  expect(await readLibrary(f.context)).toEqual([])
  const result = await f.store.consume(op.operationId, f.context)
  expect(await f.store.consume(op.operationId, f.context)).toEqual(result)
  expect(await readLibrary(f.context)).toMatchObject([{ title: 'Queued' }])
})
it('fails closed on corrupt revisions and validates imports before writing any record', async () => {
  const f = await fixture()
  await expect(
    f.store.mutate({ action: 'import', content: '[{"title":"OK"},{"title":""}]' }, f.context),
  ).rejects.toMatchObject({ code: 'LIBRARY_TITLE_REQUIRED' })
  expect(await readLibrary(f.context)).toEqual([])
  const row = (await f.store.mutate({ action: 'save', record: { title: 'Stored' } }, f.context)).records[0]
  await expect(
    f.store.mutate(
      { action: 'import', id: row.id, revision: row.revision, content: '[{"title":"A"},{"title":"B"}]' },
      f.context,
    ),
  ).rejects.toMatchObject({ code: 'LIBRARY_IMPORT_INVALID' })
  expect(await readLibrary(f.context)).toHaveLength(1)
  await writeFile(join(f.root, `.agnes/science/library/${row.revision}.json`), '{}')
  await expect(readLibrary(f.context)).rejects.toMatchObject({ code: 'LIBRARY_CORRUPT' })
})

it('binds a library upload to its unique authorized attachment and keeps its original display name', async () => {
  const f = await fixture()
  const first = (await f.store.mutate({ action: 'save', record: { title: 'Paper' } }, f.context)).records[0]
  f.context.session.readAttachment = async ({ path }) => {
    if (path === 'session-file://list')
      return {
        name: 'Attachments',
        mimeType: 'text/plain',
        bytes: Buffer.from(
          '1. session-file://3/1 "other.pdf" (application/pdf)\n2. session-file://4/1 "unique-paper.pdf" (application/pdf)',
        ),
      }
    if (path === 'session-file://4/1')
      return { name: 'unique-paper.pdf', mimeType: 'application/pdf', bytes: Buffer.from('%PDF-test') }
    return undefined
  }
  const saved = await f.store.mutate(
    {
      action: 'attach',
      id: first.id,
      revision: first.revision,
      path: 'session-file://upload',
      uploadName: 'unique-paper.pdf',
      filename: 'paper.pdf',
    },
    f.context,
  )
  expect(saved.records[0].files).toMatchObject([{ name: 'paper.pdf', mime: 'application/pdf' }])
  await expect(
    f.store.mutate(
      {
        action: 'attach',
        id: first.id,
        revision: saved.records[0].revision,
        path: 'session-file://upload',
        uploadName: 'not-uploaded.pdf',
      },
      f.context,
    ),
  ).rejects.toMatchObject({ code: 'LIBRARY_ATTACHMENT_INVALID' })
})

it('preserves simultaneous revision branches and refuses to silently select a winner', async () => {
  const f = await fixture()
  const first = (await f.store.mutate({ action: 'save', record: { title: 'Original' } }, f.context))
    .records[0]
  for (const title of ['Writer A', 'Writer B']) {
    const revision = randomUUID()
    await writeFile(
      join(f.root, `.agnes/science/library/${revision}.json`),
      JSON.stringify({ ...first, title, revision, parent: first.revision }),
    )
  }
  await expect(readLibrary(f.context)).rejects.toMatchObject({ code: 'LIBRARY_CONFLICT' })
  expect((await readdir(join(f.root, '.agnes/science/library'))).length).toBe(3)
})
