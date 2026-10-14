import { createHash, randomUUID } from 'node:crypto'
import { exportCitations, importCsl, normalizeRecord } from './citations.mjs'
import { boundedRead } from './core.mjs'
import { enumeration, fail, integer, object, optional, result, string, tool } from './schema.mjs'

const ROOT = '.agnes/science'
const INDEX = `${ROOT}/library`
const MAX_FILE = 16 * 1024 * 1024
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/
const HASH = /^[0-9a-f]{64}$/
const missing = (e) => e?.code === 'ENOENT' || e?.cause?.code === 'ENOENT'
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const owner = (ctx) => ctx.sessionId ?? ctx.session?.key
const recordInput = {
  [Symbol.for('TypeBox.Kind')]: 'Object',
  type: 'object',
  properties: {},
  additionalProperties: true,
}
const inputSchema = object({
  action: enumeration('save', 'import', 'attach', 'remove'),
  record: optional(recordInput),
  id: optional(string(64)),
  revision: optional(string(64)),
  content: optional(string(256000)),
  path: optional(string()),
  fileId: optional(string(64)),
  uploadName: optional(string(255)),
  filename: optional(string(255)),
})

/** Immutable revision files; a failed write never replaces a committed library snapshot. */
export async function readLibrary(ctx) {
  let entries
  try {
    entries = await ctx.fs.list(INDEX)
  } catch (e) {
    if (missing(e)) return []
    throw e
  }
  const names = entries.filter((e) => e.kind === 'file' && /^[0-9a-f-]{36}\.json$/.test(e.name))
  if (names.length > 2000) throw fail('LIBRARY_CAPACITY', 'The project library revision limit was reached.')
  const revisions = []
  for (const entry of names) {
    ctx.signal.throwIfAborted()
    const bytes = await boundedRead(ctx, `${INDEX}/${entry.name}`, 256000)
    let row
    try {
      row = JSON.parse(new TextDecoder().decode(bytes))
    } catch {
      throw fail('LIBRARY_CORRUPT', 'A library revision cannot be decoded.')
    }
    if (
      row.schemaVersion !== 1 ||
      !UUID.test(row.id) ||
      !UUID.test(row.revision) ||
      entry.name !== `${row.revision}.json` ||
      (row.parent !== null && !UUID.test(row.parent)) ||
      !Array.isArray(row.files)
    )
      throw fail('LIBRARY_CORRUPT', 'A library revision has invalid identity.')
    const normalized = normalizeRecord(row)
    if (row.files.length > 200) throw fail('LIBRARY_CORRUPT', 'Too many file versions.')
    for (const f of row.files) {
      if (
        !UUID.test(f.id) ||
        !UUID.test(f.version) ||
        !HASH.test(f.sha256) ||
        !Number.isSafeInteger(f.size) ||
        f.size < 0 ||
        f.size > MAX_FILE ||
        typeof f.name !== 'string' ||
        typeof f.mime !== 'string'
      )
        throw fail('LIBRARY_CORRUPT', 'A library file version is invalid.')
    }
    revisions.push({ ...row, ...normalized })
  }
  const parents = new Set(revisions.map((r) => r.parent).filter(Boolean))
  const byRevision = new Map(revisions.map((r) => [r.revision, r]))
  for (const row of revisions) {
    const visited = new Set()
    let current = row
    while (current.parent) {
      if (visited.has(current.revision))
        throw fail('LIBRARY_CORRUPT', 'Library revision history contains a cycle.')
      visited.add(current.revision)
      const parent = byRevision.get(current.parent)
      if (!parent || parent.id !== row.id)
        throw fail('LIBRARY_CORRUPT', 'Library revision history is incomplete.')
      current = parent
    }
  }
  const heads = revisions.filter((r) => !parents.has(r.revision))
  if (new Set(heads.map((r) => r.id)).size !== heads.length)
    throw fail(
      'LIBRARY_CONFLICT',
      'Concurrent library revisions need reconciliation; no revision was discarded.',
    )
  return heads.filter((r) => !r.deleted).sort((a, b) => a.title.localeCompare(b.title))
}
const latest = (rows, id) =>
  rows.find((r) => r.id === id) ??
  (() => {
    throw fail('LIBRARY_NOT_FOUND', 'Literature record not found.')
  })()

export class LiteratureStore {
  locks = new Map()
  pending = new Map()
  async mutate(input, ctx) {
    const key = ctx.cwd
    const before = this.locks.get(key) ?? Promise.resolve()
    const work = before.catch(() => {}).then(() => this.apply(input, ctx))
    this.locks.set(key, work)
    try {
      return await work
    } finally {
      if (this.locks.get(key) === work) this.locks.delete(key)
    }
  }
  async apply(input, ctx) {
    ctx.signal.throwIfAborted()
    const rows = await readLibrary(ctx)
    let updates
    let published
    if (input.action === 'save' || input.action === 'import') {
      if (input.action === 'import' && (input.id || input.revision))
        throw fail('LIBRARY_IMPORT_INVALID', 'Import creates new records; edit an existing record with save.')
      const values =
        input.action === 'import' ? importCsl(input.content) : [normalizeRecord(input.record ?? {})]
      const seen = new Set()
      updates = values.map((value) => {
        if (value.doi && (seen.has(value.doi) || rows.some((r) => r.doi === value.doi && r.id !== input.id)))
          throw fail('LIBRARY_DUPLICATE_DOI', 'This DOI already exists. Edit its existing library record.')
        if (value.doi) seen.add(value.doi)
        const prior = input.id ? latest(rows, input.id) : undefined
        if (prior && prior.revision !== input.revision)
          throw fail('LIBRARY_STALE_REVISION', 'The record changed. Refresh before saving.')
        return {
          ...value,
          id: prior?.id ?? randomUUID(),
          parent: prior?.revision ?? null,
          files: prior?.files ?? [],
        }
      })
    } else {
      const prior = latest(rows, input.id)
      if (prior.revision !== input.revision)
        throw fail('LIBRARY_STALE_REVISION', 'The record changed. Refresh before saving.')
      if (input.action === 'remove') updates = [{ ...prior, parent: prior.revision, deleted: true }]
      else if (input.action === 'attach') {
        if (input.path === 'session-file://upload') {
          if (!input.uploadName) throw fail('LIBRARY_ATTACHMENT_INVALID', 'Upload identity is missing.')
          let found
          for (let offset = 1; offset <= 10000 && !found; offset += 100) {
            const list = await ctx.session.readAttachment({
              path: 'session-file://list',
              offset,
              limit: 100,
              maxBytes: 32768,
            })
            const lines = new TextDecoder().decode(list.bytes).split('\n')
            for (const line of lines) {
              const match = /^\d+\. (session-file:\/\/\d+\/\d+) ("(?:[^"\\]|\\.)*") /.exec(line)
              if (match && JSON.parse(match[2]) === input.uploadName) found = match[1]
            }
            const continuation = lines.at(-1)?.match(/offset=(\d+)/)
            if (!continuation) break
            offset = Number(continuation[1]) - 100
          }
          if (!found)
            throw fail('LIBRARY_ATTACHMENT_INVALID', 'The selected upload is not present in this session.')
          input = { ...input, path: found }
        }
        const attachment = input.path?.startsWith('session-file://')
          ? await ctx.session.readAttachment({ path: input.path })
          : undefined
        const bytes =
          attachment?.bytes ??
          (input.path && !input.path.startsWith('session-file://')
            ? await boundedRead(ctx, input.path)
            : undefined)
        if (!bytes || bytes.byteLength > MAX_FILE)
          throw fail(
            'LIBRARY_ATTACHMENT_INVALID',
            'Select an authorized attachment or local file up to 16 MiB.',
          )
        const name = input.filename ?? attachment?.name ?? input.path.split(/[\\/]/).at(-1)
        const mime =
          attachment?.mimeType && attachment.mimeType !== 'application/octet-stream'
            ? attachment.mimeType
            : mimeFor(name)
        if (
          !name ||
          name.length > 255 ||
          [...name].some((c) => c === '/' || c === '\\' || c.charCodeAt(0) < 32)
        )
          throw fail('LIBRARY_ATTACHMENT_INVALID', 'Invalid display filename.')
        const hash = digest(bytes)
        const fileId = input.fileId ?? randomUUID()
        if (input.fileId && !prior.files.some((f) => f.id === input.fileId))
          throw fail('LIBRARY_FILE_NOT_FOUND', 'Select an existing file before adding a version.')
        const file = {
          id: fileId,
          version: randomUUID(),
          sha256: hash,
          size: bytes.byteLength,
          name,
          mime,
          createdAt: new Date().toISOString(),
        }
        const path = `${ROOT}/files/${hash}.bin`
        try {
          const existing = await boundedRead(ctx, path)
          if (digest(existing) !== hash) throw fail('LIBRARY_FILE_CORRUPT', 'Stored file checksum mismatch.')
        } catch (e) {
          if (!missing(e)) throw e
          await ctx.fs.write(path, bytes)
        }
        ctx.signal.throwIfAborted()
        const ref = await ctx.artifacts.put(bytes, { name, mime })
        published = { ref, mime }
        updates = [{ ...prior, parent: prior.revision, files: [...prior.files, file] }]
      } else throw fail('LIBRARY_ACTION_INVALID', 'Unknown library operation.')
    }
    if (rows.length + updates.filter((r) => !rows.some((prior) => prior.id === r.id)).length > 500)
      throw fail('LIBRARY_CAPACITY', 'The project library is limited to 500 records.')
    const committed = []
    let count = 0
    try {
      count = (await ctx.fs.list(INDEX)).filter((e) => e.kind === 'file' && e.name.endsWith('.json')).length
    } catch (e) {
      if (!missing(e)) throw e
    }
    if (count + updates.length > 2000)
      throw fail('LIBRARY_CAPACITY', 'The project library revision limit was reached.')
    for (const row of updates) {
      const revision = randomUUID()
      const next = { ...row, schemaVersion: 1, revision, updatedAt: new Date().toISOString() }
      if (next.files.length > 200) throw fail('LIBRARY_CAPACITY', 'A record is limited to 200 file versions.')
      ctx.signal.throwIfAborted()
      const encoded = JSON.stringify(next)
      if (Buffer.byteLength(encoded) > 256000)
        throw fail('LIBRARY_CAPACITY', 'Record metadata exceeds the revision byte limit.')
      await ctx.fs.write(`${INDEX}/${revision}.json`, encoded)
      committed.push(next)
    }
    return { records: committed, ...(published ? { published } : {}) }
  }
  enqueue(input, ctx) {
    if (!owner(ctx)) throw fail('LIBRARY_SESSION_REQUIRED', 'An active session is required.')
    for (const [id, op] of this.pending) if (Date.now() - op.created > 600000) this.pending.delete(id)
    if (this.pending.size >= 100) throw fail('LIBRARY_BUSY', 'Too many pending library operations.')
    const id = randomUUID()
    this.pending.set(id, {
      input: structuredClone(input),
      owner: owner(ctx),
      cwd: ctx.cwd,
      created: Date.now(),
      status: 'queued',
    })
    return { operationId: id, status: 'queued' }
  }
  async consume(id, ctx) {
    const op = this.pending.get(id)
    if (!op || op.owner !== owner(ctx) || op.cwd !== ctx.cwd || Date.now() - op.created > 600000)
      throw fail('LIBRARY_OPERATION_UNKNOWN', 'Operation expired or belongs to another session.')
    if (op.status === 'completed') return op.result
    if (op.status !== 'queued') throw fail('LIBRARY_OPERATION_BUSY', 'Operation is not queued.')
    op.status = 'running'
    try {
      op.result = await this.mutate(op.input, ctx)
      op.status = 'completed'
      return op.result
    } catch (e) {
      op.status = 'failed'
      op.message = e.publicMessage ?? 'Library operation failed.'
      throw e
    }
  }
}
function mimeFor(name) {
  const ext = name.split('.').at(-1).toLowerCase()
  return (
    {
      pdf: 'application/pdf',
      csv: 'text/csv',
      tsv: 'text/tab-separated-values',
      json: 'application/json',
      pdb: 'chemical/x-pdb',
      mol: 'chemical/x-mdl-molfile',
      sdf: 'chemical/x-mdl-sdfile',
      xyz: 'chemical/x-xyz',
      md: 'text/markdown',
    }[ext] ?? 'text/plain'
  )
}

export function registerLiterature(ctx, store) {
  const extension = ctx.extension()
  const register = (name, kind, schema, handler) =>
    ctx.services?.register({
      name: `science.library.${name}`,
      kind,
      inputSchema: JSON.parse(JSON.stringify(schema)),
      outputSchema: { type: 'object', additionalProperties: true },
      timeoutMs: 30000,
      maxResultBytes: 1048576,
      handler: async (input, context) => {
        try {
          return await handler(input, context)
        } catch (e) {
          if (context.signal.aborted) throw e
          return {
            error: e.publicMessage ?? 'Library unavailable. Check workspace permissions.',
            code: e.publicMessage ? e.code : 'LIBRARY_UNAVAILABLE',
          }
        }
      },
    })
  register('list', 'query', object({ offset: optional(integer(0, 500)) }), async (i, c) => {
    const rows = await readLibrary(c)
    const offset = i.offset ?? 0
    const records = []
    let used = 128
    for (const row of rows.slice(offset)) {
      const size = Buffer.byteLength(JSON.stringify(row))
      if (used + size > 800000) break
      records.push(row)
      used += size
    }
    return { records, nextOffset: offset + records.length, hasMore: offset + records.length < rows.length }
  })
  register('enqueue', 'effect', inputSchema, (i, c) => store.enqueue(i, c))
  register('status', 'query', object({ operationId: string(64) }), async (i, c) => {
    const op = store.pending.get(i.operationId)
    if (!op || op.owner !== owner(c) || op.cwd !== c.cwd || Date.now() - op.created > 600000)
      return { status: 'unknown' }
    return { status: op.status, ...(op.message ? { error: op.message } : {}) }
  })
  register(
    'export',
    'query',
    object({
      format: enumeration('bibtex', 'ris', 'csl'),
      ids: optional({ type: 'array', items: { type: 'string', maxLength: 64 }, maxItems: 500 }),
    }),
    async (i, c) => {
      const rows = await readLibrary(c)
      const exported = exportCitations(i.ids ? i.ids.map((id) => latest(rows, id)) : rows, i.format)
      if (Buffer.byteLength(exported.content) > 800000)
        throw fail(
          'LIBRARY_EXPORT_TOO_LARGE',
          'Export selected references; the full citation export exceeds the query limit.',
        )
      return exported
    },
  )
  register(
    'file',
    'query',
    object({ id: string(64), version: string(64), offset: integer(0, MAX_FILE) }),
    async (i, c) => {
      const record = latest(await readLibrary(c), i.id)
      const file = record.files.find((f) => f.version === i.version)
      if (!file) throw fail('LIBRARY_FILE_NOT_FOUND', 'File version not found.')
      const bytes = await boundedRead(c, `${ROOT}/files/${file.sha256}.bin`)
      if (bytes.byteLength !== file.size || digest(bytes) !== file.sha256)
        throw fail('LIBRARY_FILE_CORRUPT', 'File checksum mismatch.')
      if (i.offset > bytes.byteLength) throw fail('LIBRARY_OFFSET_INVALID', 'Invalid file offset.')
      const end = Math.min(i.offset + 384 * 1024, bytes.byteLength)
      return {
        file,
        offset: i.offset,
        nextOffset: end,
        base64: Buffer.from(bytes.subarray(i.offset, end)).toString('base64'),
      }
    },
  )
  extension.registerTool(
    tool(
      'library_apply',
      'Apply one immutable operation queued by the Literature Library UI. The operation must belong to this session. File writes use ordinary session authorization.',
      object({ operationId: string(64) }),
      false,
      async (i, c) => {
        const value = await store.consume(i.operationId, c)
        return {
          ...result(value),
          ...(value.published
            ? { content: [{ type: 'ref', ...value.published }, ...result(value).content] }
            : {}),
        }
      },
    ),
  )
  extension.registerTool(
    tool(
      'library_update',
      'Persist literature metadata, import CSL-JSON, attach an authorized session-file:// or workspace path, add an immutable file version, or remove a literature record. Updates require the current revision from science_library_list.',
      inputSchema,
      false,
      async (i, c) => {
        const value = await store.mutate(i, c)
        return {
          ...result(value),
          ...(value.published
            ? { content: [{ type: 'ref', ...value.published }, ...result(value).content] }
            : {}),
        }
      },
    ),
  )
  extension.registerTool(
    tool(
      'library_list',
      'Read the project Literature Library with file version identities.',
      object({}),
      true,
      async (_, c) => result({ records: await readLibrary(c) }),
    ),
  )
  extension.registerTool(
    tool(
      'library_export',
      'Export the project literature as BibTeX, RIS or CSL-JSON and publish it as an Artifact.',
      object({ format: enumeration('bibtex', 'ris', 'csl') }),
      false,
      async (i, c) => {
        const output = exportCitations(await readLibrary(c), i.format)
        const ref = await c.artifacts.put(Buffer.from(output.content), {
          name: output.filename,
          mime: output.mime,
        })
        return {
          content: [{ type: 'ref', ref, mime: output.mime }],
          structured: { ref, filename: output.filename },
        }
      },
    ),
  )
}
