// Portable citation projections. No network retrieval or execution of imported text.
import { fail } from './schema.mjs'

const text = (value, limit = 2048) => {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string' || value.length > limit || [...value].some((c) => c.charCodeAt(0) < 9))
    throw fail('LIBRARY_METADATA_INVALID', 'Invalid or oversized literature metadata.')
  return value.trim()
}
export function normalizeRecord(input) {
  const title = text(input.title)
  if (!title) throw fail('LIBRARY_TITLE_REQUIRED', 'A literature title is required.')
  const authors =
    input.authors ??
    input.author?.map((a) => a.literal ?? [a.given, a.family].filter(Boolean).join(' ')) ??
    []
  const tags = input.tags ?? []
  if (!Array.isArray(authors) || authors.length > 100 || !Array.isArray(tags) || tags.length > 50)
    throw fail('LIBRARY_METADATA_INVALID', 'Authors and tags must be bounded arrays.')
  const doi = text(input.doi ?? input.DOI)
    .replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, '')
    .toLowerCase()
  if (doi && !/^10\.\d{4,9}\/\S+$/.test(doi)) throw fail('LIBRARY_DOI_INVALID', 'Invalid DOI.')
  const year = String(input.year ?? input.issued?.['date-parts']?.[0]?.[0] ?? '')
  if (year && !/^\d{4}$/.test(year)) throw fail('LIBRARY_YEAR_INVALID', 'Use a four digit publication year.')
  const url = text(input.url ?? input.URL)
  if (url) {
    let parsed
    try {
      parsed = new URL(url)
    } catch {
      throw fail('LIBRARY_URL_INVALID', 'Invalid literature URL.')
    }
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password)
      throw fail('LIBRARY_URL_INVALID', 'Use an HTTP(S) literature URL without credentials.')
  }
  return {
    title,
    authors: authors.map((a) => text(a, 256)),
    year,
    doi,
    journal: text(input.journal ?? input['container-title']),
    url,
    tags: [...new Set(tags.map((tag) => text(tag, 128)).filter(Boolean))],
    collection: text(input.collection, 128),
    notes: text(input.notes, 16000),
  }
}
export function importCsl(content) {
  let values
  try {
    values = JSON.parse(content)
  } catch {
    throw fail('LIBRARY_IMPORT_INVALID', 'Import a CSL-JSON array or record.')
  }
  const rows = Array.isArray(values) ? values : [values]
  if (!rows.length || rows.length > 100 || rows.some((r) => !r || typeof r !== 'object' || Array.isArray(r)))
    throw fail('LIBRARY_IMPORT_INVALID', 'Import between 1 and 100 literature records.')
  return rows.map(normalizeRecord)
}
export function exportCitations(records, format) {
  const csl = records.map((r) => ({
    id: r.id,
    type: 'article-journal',
    title: r.title,
    author: r.authors.map((literal) => ({ literal })),
    ...(r.year ? { issued: { 'date-parts': [[Number(r.year)]] } } : {}),
    ...(r.doi ? { DOI: r.doi } : {}),
    ...(r.url ? { URL: r.url } : {}),
    ...(r.journal ? { 'container-title': r.journal } : {}),
  }))
  if (format === 'csl')
    return { filename: 'references.json', mime: 'application/json', content: JSON.stringify(csl, null, 2) }
  // Escape field syntax, retaining literal metadata (including malicious-looking text).
  const bib = (v) =>
    String(v)
      .replace(/\\/g, '\\textbackslash{}')
      .replace(/[{}%&#_$]/g, (c) => `\\${c}`)
      .replace(/[\r\n]+/g, ' ')
  const line = (v) => String(v).replace(/[\r\n]+/g, ' ')
  if (format === 'bibtex')
    return {
      filename: 'references.bib',
      mime: 'text/plain',
      content: records
        .map(
          (r) =>
            `@article{ref${r.id.replace(/[^a-zA-Z0-9]/g, '')},\n${Object.entries({
              title: r.title,
              author: r.authors.join(' and '),
              year: r.year,
              journal: r.journal,
              doi: r.doi,
              url: r.url,
            })
              .filter(([, v]) => v)
              .map(([k, v]) => `  ${k} = {${bib(v)}}`)
              .join(',\n')}\n}`,
        )
        .join('\n\n'),
    }
  if (format === 'ris')
    return {
      filename: 'references.ris',
      mime: 'application/x-research-info-systems',
      content: records
        .map((r) =>
          [
            'TY  - JOUR',
            `TI  - ${line(r.title)}`,
            ...r.authors.map((a) => `AU  - ${line(a)}`),
            ...[
              ['PY', r.year],
              ['JO', r.journal],
              ['DO', r.doi],
              ['UR', r.url],
            ]
              .filter(([, v]) => v)
              .map(([k, v]) => `${k}  - ${line(v)}`),
            'ER  - ',
            '',
          ].join('\r\n'),
        )
        .join('\r\n'),
    }
  throw fail('LIBRARY_EXPORT_FORMAT', 'Use bibtex, ris or csl.')
}
