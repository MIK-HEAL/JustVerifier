import { freezeDeep, sha256 } from './canonical.js'

export type SkillFrontmatter = Readonly<{ name?: string; description?: string; metadata: Readonly<Record<string, string>>; body: string; hasFrontmatter: boolean }>

function parseScalar(value: string): string | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1)
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const values = trimmed
      .slice(1, -1)
      .split(',')
      .map((entry) => entry.trim().replace(/^['"]|['"]$/gu, ''))
      .filter(Boolean)
    return values.length ? values.join(', ') : undefined
  }
  return trimmed
}

/** Conservative frontmatter parser for SKILL.md. Unknown YAML structures stay in the body. */
export function parseSkillFrontmatter(raw: string): SkillFrontmatter {
  const normalized = raw.replace(/\r\n?/gu, '\n')
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(normalized)
  if (!match) return { metadata: {}, body: raw, hasFrontmatter: false }
  const fields: Record<string, string> = {}
  for (const line of match[1]!.split('\n')) {
    const separator = line.indexOf(':')
    if (separator <= 0) continue
    const key = line.slice(0, separator).trim().toLowerCase()
    const value = parseScalar(line.slice(separator + 1))
    if (key && value) fields[key] = value
  }
  const { name, description, ...metadata } = fields
  return { ...(name ? { name } : {}), ...(description ? { description } : {}), metadata, body: normalized.slice(match[0].length).replace(/^\n+/u, ''), hasFrontmatter: true }
}

export function isSafeSkillReferenceName(name: string): boolean {
  return name.length > 0 && !/[<>:"/\\|?*]/u.test(name) && !Array.from(name).some((character) => character.charCodeAt(0) < 32) && !/[. ]$/u.test(name) && !/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(name)
}

export type SkillProvenance = Readonly<{ id: string; version: string; source: string; trust: 'trusted' | 'untrusted'; contentChecksum: string }>
export function buildSkillProvenance(input: Readonly<{ id: string; version: string; source: string; trust: SkillProvenance['trust']; content: string }>): SkillProvenance {
  if (!isSafeSkillReferenceName(input.id)) throw new Error('skill id is not a safe portable reference')
  return freezeDeep({ id: input.id, version: input.version, source: input.source, trust: input.trust, contentChecksum: sha256(input.content) })
}
