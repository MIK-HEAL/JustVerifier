import { array, enumeration, fail, integer, object, optional, result, string, tool } from './schema.mjs'

const MAX_FILE = 16 * 1024 * 1024
export async function boundedRead(ctx, path, limit = MAX_FILE) {
  const stat = await ctx.fs.stat(path)
  if (stat.kind !== 'file' || stat.size > limit)
    throw fail('SCIENCE_FILE_TOO_LARGE', `Expected a regular file no larger than ${limit} bytes.`)
  // The Host's offset/limit options count text lines and decode UTF-8. Do not use them for binary files.
  const bytes = await ctx.fs.read(path)
  if (bytes.byteLength > limit) throw fail('SCIENCE_FILE_TOO_LARGE', `The file exceeds ${limit} bytes.`)
  return bytes
}

export function coreTools() {
  return [
    tool(
      'write_artifact_file',
      'Publish a generated file through Agnes artifact storage. Supply content or an existing local path, never both. Files are read through the current session file policy.',
      object({
        filename: string(255),
        mimeType: optional(string(128)),
        content: optional(string(MAX_FILE, 0)),
        path: optional(string()),
        encoding: optional(enumeration('utf8', 'base64')),
      }),
      false,
      async (args, ctx) => {
        if ((args.content !== undefined) === (args.path !== undefined))
          throw fail('SCIENCE_ARTIFACT_SOURCE', 'Provide exactly one of content or path.')
        if ([...args.filename].some((char) => char === '/' || char === '\\' || char.charCodeAt(0) < 32))
          throw fail('SCIENCE_FILENAME_INVALID', 'Use a display filename without directory separators.')
        if (
          args.encoding === 'base64' &&
          args.content !== undefined &&
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(args.content)
        )
          throw fail('SCIENCE_BASE64_INVALID', 'The content is not valid base64.')
        const bytes = args.path
          ? await boundedRead(ctx, args.path)
          : Buffer.from(args.content, args.encoding ?? 'utf8')
        if (bytes.byteLength > MAX_FILE)
          throw fail('SCIENCE_FILE_TOO_LARGE', 'Artifacts are limited to 16 MiB per call.')
        ctx.signal.throwIfAborted()
        const ref = await ctx.artifacts.put(bytes, {
          name: args.filename,
          mime: args.mimeType ?? 'application/octet-stream',
        })
        return {
          content: [{ type: 'ref', ref, mime: args.mimeType ?? 'application/octet-stream' }],
          structured: { ref, filename: args.filename, size: bytes.byteLength },
        }
      },
    ),
    tool(
      'set_plan',
      'Set the Agnes session plan. This records progress only; it does not grant execution approval. Send the complete current plan when updating a step.',
      object({
        items: array(
          object({
            id: string(128),
            text: string(),
            status: enumeration('todo', 'doing', 'done', 'blocked'),
            check: optional(string()),
          }),
        ),
      }),
      false,
      async ({ items }, ctx) => {
        if (new Set(items.map((item) => item.id)).size !== items.length)
          throw fail('SCIENCE_PLAN_DUPLICATE', 'Plan item IDs must be unique.')
        return result({ seq: await ctx.plan.set(items), items })
      },
    ),
    tool(
      'read_document',
      'Read an uploaded document through the Agnes document reader, including its PDF/OCR support. Use a session-file:// reference. Native document_read options and limitations apply.',
      object({
        path: string(96),
        page: optional(integer(1, 10000)),
        mode: optional(enumeration('auto', 'text', 'image')),
      }),
      true,
      async (args, ctx) => ctx.tools.invoke('document_read', args, { signal: ctx.signal }),
    ),
    tool(
      'request_skill_import',
      'Prepare a Skill import using the Agnes skill helper. The native installation approval flow remains required.',
      object({
        source: string(),
        name: optional(string(128)),
        scope: optional(enumeration('workspace', 'user')),
      }),
      false,
      async (args, ctx) => ctx.tools.invoke('skill_helper_import', args, { signal: ctx.signal }),
    ),
  ]
}
