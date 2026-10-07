export const SCIENCE_EXTENSION = Object.freeze({
  id: 'open-science',
  name: 'Resource bundle',
  description: '科研分析、文献检索、Notebook 和可复现产物工具。',
  skills: Object.freeze([
    'literature-review',
    'paper-narrative',
    'figure-composer',
    'figure-style',
    'compute-env-setup',
    'indication-dossier',
  ]),
  mcp: Object.freeze([
    'open-science-notebook',
    'open-science-artifacts',
    'open-science-literature',
    'open-science-library',
  ]),
})
export type ScienceExtensionState = 'enabled' | 'partial' | 'disabled' | 'unavailable'
export function scienceExtensionState(
  skills: readonly { name?: string; desired?: string; actual?: string }[],
  mcp: readonly { serverId?: string; desired?: string; actual?: string }[],
): ScienceExtensionState {
  const skillMatches = skills.filter((item) => SCIENCE_EXTENSION.skills.includes(item.name ?? ''))
  const mcpMatches = mcp.filter((item) => SCIENCE_EXTENSION.mcp.includes(item.serverId ?? ''))
  const total = SCIENCE_EXTENSION.skills.length + SCIENCE_EXTENSION.mcp.length
  const enabled =
    skillMatches.filter((item) => item.desired === 'enabled' || item.actual === 'ready').length +
    mcpMatches.filter((item) => item.desired === 'enabled' || item.actual === 'ready').length
  if (enabled === total) return 'enabled'
  if (enabled > 0) return 'partial'
  if (skillMatches.length + mcpMatches.length === 0) return 'unavailable'
  return 'disabled'
}
