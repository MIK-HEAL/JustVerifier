import { fail, integer, object, optional, result, string, tool } from './schema.mjs'

function publicEndpoint(endpoint) {
  let url
  try {
    url = new URL(endpoint)
  } catch {
    throw fail('SCIENCE_ENDPOINT_INVALID', 'Provide a valid HTTPS literature API endpoint.')
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash)
    throw fail(
      'SCIENCE_ENDPOINT_INVALID',
      'The literature API endpoint must use HTTPS without URL credentials or a fragment.',
    )
  return url
}
async function fetchJson(ctx, endpoint) {
  // The Host owns network authorization, DNS and redirects. Its public fetch additionally bounds
  // both transfer and decoding, and keeps response-body cleanup within the same policy boundary.
  if (!ctx.net.fetchPublic)
    throw fail('SCIENCE_PUBLIC_FETCH_REQUIRED', 'This Host does not provide bounded public retrieval.')
  const response = await ctx.net.fetchPublic(endpoint.toString())
  ctx.signal.throwIfAborted()
  if (response.statusCode < 200 || response.statusCode >= 300 || response.body.kind === 'zip')
    throw fail(
      'SCIENCE_LIBRARY_REQUEST_FAILED',
      'The literature service did not return a successful text response.',
    )
  if (response.truncation.bytes || response.truncation.decoded || response.body.content.length > 1024 * 1024)
    throw fail(
      'SCIENCE_LIBRARY_TOO_LARGE',
      'The literature response exceeds the bounded JSON limit. Narrow the query.',
    )
  try {
    return JSON.parse(response.body.content)
  } catch {
    throw fail('SCIENCE_LIBRARY_INVALID_RESPONSE', 'The literature service returned invalid JSON.')
  }
}

export function libraryTools() {
  return [
    tool(
      'search_library',
      'Query a user-selected public JSON literature API using q and limit parameters. This queries that API, not a personal desktop library. Use only an API that supports these parameters.',
      object({ endpoint: string(2048), query: string(1024), limit: optional(integer(1, 100)) }),
      true,
      async ({ endpoint, query, limit }, ctx) => {
        const url = publicEndpoint(endpoint)
        url.searchParams.set('q', query)
        url.searchParams.set('limit', String(limit ?? 10))
        return result(await fetchJson(ctx, url))
      },
    ),
    tool(
      'read_library_abstract',
      'Read one record from a user-selected public JSON literature API at endpoint/id. The API must support this path convention; this does not read a personal desktop library.',
      object({ endpoint: string(2048), id: string(512) }),
      true,
      async ({ endpoint, id }, ctx) => {
        if (id === '.' || id === '..')
          throw fail('SCIENCE_RECORD_INVALID', 'A record identifier cannot be a dot path.')
        const url = publicEndpoint(endpoint)
        url.pathname = `${url.pathname.replace(/\/$/, '')}/${encodeURIComponent(id)}`
        return result(await fetchJson(ctx, url))
      },
    ),
  ]
}
