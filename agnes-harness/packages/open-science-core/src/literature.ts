import { freezeDeep, sha256 } from './canonical.js'

export type LiteratureIdentifierScheme = 'doi' | 'pmid' | 'pmcid' | 'arxiv' | 'isbn' | 'issn' | 'other'

export function normalizeLiteratureIdentifier(scheme: LiteratureIdentifierScheme, value: string): string {
  const trimmed = value.trim()
  if (scheme === 'doi') return trimmed.replace(/^doi:\s*/iu, '').replace(/^https?:\/\/(?:dx\.)?doi\.org\//iu, '').replace(/[.,;:)}\]]+$/gu, '').trim()
  if (scheme === 'pmid') return /^https?:\/\/(?:www\.)?pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)\/?(?:[?#].*)?$/iu.exec(trimmed.replace(/^PMID\s*:\s*/iu, ''))?.[1] ?? trimmed.replace(/^PMID\s*:\s*/iu, '')
  if (scheme === 'pmcid') {
    const candidate = trimmed.replace(/^PMCID\s*:\s*/iu, '')
    const fromUrl = /^(?:https?:\/\/)?(?:pmc\.ncbi\.nlm\.nih\.gov\/articles\/|www\.ncbi\.nlm\.nih\.gov\/pmc\/articles\/)?(PMC?\d+)\/?(?:[?#].*)?$/iu.exec(candidate)?.[1] ?? candidate
    const digits = /^(?:PMC)?(\d+)$/iu.exec(fromUrl)?.[1]
    return digits ? `PMC${digits}` : fromUrl.toUpperCase()
  }
  if (scheme === 'arxiv') return trimmed.replace(/^arxiv:\s*/iu, '').replace(/^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\//iu, '').replace(/[?#].*$/u, '').replace(/\.pdf$/iu, '').replace(/v\d+$/iu, '').trim()
  return trimmed
}

export function literatureIdentifierUrl(scheme: LiteratureIdentifierScheme, value: string): string | undefined {
  const normalized = normalizeLiteratureIdentifier(scheme, value)
  if (scheme === 'doi' && /^10\.\d{4,9}\/\S+$/u.test(normalized)) return `https://doi.org/${normalized.split('/').map(encodeURIComponent).join('/')}`
  if (scheme === 'pmid' && /^\d+$/u.test(normalized)) return `https://pubmed.ncbi.nlm.nih.gov/${normalized}/`
  if (scheme === 'pmcid' && /^PMC\d+$/u.test(normalized)) return `https://pmc.ncbi.nlm.nih.gov/articles/${normalized}/`
  if (scheme === 'arxiv' && /^(?:\d{4}\.\d{4,5}|[a-z][a-z.-]*\/\d{7})$/iu.test(normalized)) return `https://arxiv.org/abs/${normalized}`
  return undefined
}

export const normalizeLiteratureSearchText = (value: string): string => value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase()

export type LiteratureCreator = Readonly<{ family?: string; given?: string; literal?: string }>
export type LiteratureReference = Readonly<{
  id: string
  title: string
  itemType: 'journalArticle' | 'review' | 'preprint' | 'conferencePaper' | 'book' | 'bookSection' | 'thesis' | 'report' | 'dataset' | 'standard' | 'patent' | 'webpage' | 'document'
  creators: readonly LiteratureCreator[]
  issuedYear?: number
  containerTitle?: string
  identifiers: readonly Readonly<{ scheme: LiteratureIdentifierScheme; value: string; isPrimary?: boolean }>[]
  url?: string
  checksum: string
}>

export function normalizeLiteratureReference(input: Readonly<Omit<LiteratureReference, 'checksum'>>): LiteratureReference {
  const identifiers = input.identifiers.map((identifier) => ({ ...identifier, value: normalizeLiteratureIdentifier(identifier.scheme, identifier.value) })).filter((identifier) => identifier.value).sort((a, b) => `${a.scheme}:${a.value}`.localeCompare(`${b.scheme}:${b.value}`))
  const base = { ...input, title: input.title.trim(), creators: input.creators.map((creator) => ({ ...creator })), identifiers }
  return freezeDeep({ ...base, checksum: sha256(base) })
}

export type CslReference = Readonly<{ id: string; type: string; title: string; author?: readonly LiteratureCreator[]; issued?: Readonly<{ 'date-parts': readonly [readonly number[]] }>; DOI?: string; URL?: string }>

const cslType: Record<LiteratureReference['itemType'], string> = { journalArticle: 'article-journal', review: 'article-journal', preprint: 'article', conferencePaper: 'paper-conference', book: 'book', bookSection: 'chapter', thesis: 'thesis', report: 'report', dataset: 'dataset', standard: 'standard', patent: 'patent', webpage: 'webpage', document: 'document' }
export function toCsl(reference: LiteratureReference): CslReference {
  const primary = reference.identifiers.find((identifier) => identifier.scheme === 'doi')
  return {
    id: reference.id,
    type: cslType[reference.itemType],
    title: reference.title,
    ...(reference.creators.length ? { author: reference.creators } : {}),
    ...(reference.issuedYear ? { issued: { 'date-parts': [[reference.issuedYear] as const] as const } } : {}),
    ...(primary ? { DOI: primary.value } : {}),
    ...(reference.url ? { URL: reference.url } : {}),
  }
}
