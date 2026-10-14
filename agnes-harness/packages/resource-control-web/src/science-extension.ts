import { AGNES_SCIENCE_MANIFEST, type AgnesScienceManifest } from '@agnes/package-manager/agnes-science-manifest'

export type ScienceExtensionManifest = Readonly<{
  id: string
  packageId: string
  version: string
  source: string
  license: string
  skillRootKey: string
  skillScope: string
  mcpServerPrefix: string
}>

/** Package identity is manifest-owned; installed rows supply actual revisions and lifecycle state. */
export const SCIENCE_EXTENSION: ScienceExtensionManifest = Object.freeze({
  id: 'agnes-science',
  ...AGNES_SCIENCE_MANIFEST,
})

export type ScienceExtensionState = 'enabled' | 'partial' | 'disabled' | 'unavailable'

type SkillResource = Readonly<{
  name?: string
  desired?: string
  actual?: string
  sourceIdentity?: Readonly<{ rootKey?: string; scope?: string }>
}>
type McpResource = Readonly<{ serverId?: string; desired?: string; actual?: string }>

export function scienceExtensionResources<S extends SkillResource, M extends McpResource>(
  skills: readonly S[],
  mcp: readonly M[],
  manifest: ScienceExtensionManifest = SCIENCE_EXTENSION,
): Readonly<{ skills: readonly S[]; mcp: readonly M[] }> {
  const selectedSkills = skills.filter((item) => {
    const source = item.sourceIdentity
    // Package-scoped descriptors are the attested projection of package manifest contributions.
    // Source-less rows are retained for older clients and fixtures that predate provenance fields.
    return source
      ? source.rootKey === manifest.skillRootKey && source.scope === manifest.skillScope
      : typeof item.name === 'string'
  })
  const selectedMcp = mcp.filter(
    (item) => typeof item.serverId === 'string' && item.serverId.startsWith(manifest.mcpServerPrefix),
  )
  return Object.freeze({ skills: Object.freeze(selectedSkills), mcp: Object.freeze(selectedMcp) })
}

export function scienceExtensionState(
  skills: readonly SkillResource[],
  mcp: readonly McpResource[],
  manifest: ScienceExtensionManifest = SCIENCE_EXTENSION,
): ScienceExtensionState {
  const selected = scienceExtensionResources(skills, mcp, manifest)
  const resources = [...selected.skills, ...selected.mcp]
  if (resources.length === 0) return 'unavailable'
  const enabled = resources.filter((item) => item.desired === 'enabled' || item.actual === 'ready').length
  // Older embedded clients did not expose sourceIdentity. Preserve their ten-row preset
  // semantics while all current descriptors use the manifest-derived discovered count.
  const hasProvenance = selected.skills.some((item) => item.sourceIdentity !== undefined)
  const expected = hasProvenance ? resources.length : 10
  if (enabled === expected && resources.length === expected) return 'enabled'
  if (enabled > 0) return 'partial'
  return 'disabled'
}

export function scienceExtensionManifest(
  manifest: AgnesScienceManifest = AGNES_SCIENCE_MANIFEST,
): ScienceExtensionManifest {
  return Object.freeze({ id: 'agnes-science', ...manifest })
}
