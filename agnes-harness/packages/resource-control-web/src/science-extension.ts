import { OPEN_SCIENCE_MANIFEST, type OpenScienceManifest } from '@agnes/package-manager/open-science-manifest'

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
  id: 'open-science',
  ...OPEN_SCIENCE_MANIFEST,
})

/** Application-owned Open-Science MCP identities. The runtime supplies session endpoints. */
export const OPEN_SCIENCE_MCP_CATALOG = Object.freeze([
  ['open-science-activity', ['begin_activity_group']],
  ['open-science-artifacts', ['write_artifact_file']],
  ['open-science-notebook', ['ask_user_question', 'notebook_execute', 'repl_execute', 'bash_execute', 'request_network_access', 'notebook_state', 'list_notebook_runtimes', 'notebook_bind_runtime', 'notebook_switch_runtime', 'notebook_restart', 'notebook_shutdown', 'inspect_packages', 'manage_packages', 'manage_environments', 'list_memory_categories', 'search_memories']],
  ['open-science-skills', ['request_skill_import']],
  ['open-science-plan', ['generate_plan', 'update_step_status']],
  ['open-science-literature', ['read_document', 'list_pdf_elements', 'read_pdf_element']],
  ['open-science-library', ['search_library', 'read_library_abstract', 'read_library_pdf', 'format_references', 'format_citation_document', 'prepare_latex_bundle', 'save_to_inbox', 'acquire_pdf']],
  ['open-science-host-message', ['send_message']],
] as const)

export function openScienceMcpDefinition(serverId: string, tools: readonly string[]): import('@agnes/protocol').McpServerDefinitionInput {
  return {
    serverId,
    displayName: `Open-Science ${serverId.slice('open-science-'.length)}`,
    // The desktop runtime replaces this session-scoped endpoint when a session is active.
    transport: { kind: 'http', url: `http://127.0.0.1:0/mcp/${serverId}` },
    secretBinding: { kind: 'none' },
    toolPolicy: { allow: [...tools] },
  }
}
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
  manifest: OpenScienceManifest = OPEN_SCIENCE_MANIFEST,
): ScienceExtensionManifest {
  return Object.freeze({ id: 'open-science', ...manifest })
}
