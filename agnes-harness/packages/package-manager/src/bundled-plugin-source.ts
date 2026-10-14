import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

declare const AGNES_PACKAGED_BUILTINS: boolean | undefined
export const BUNDLED_SKILL_HELPER_REF = 'file:./bundled-plugins/skill-helper'
export const BUNDLED_AGNES_SCIENCE_REF = 'file:./bundled-plugins/agnes-science'
export const BUNDLED_RESEARCH_VERIFIER_REF = 'file:./bundled-plugins/research-verifier'

export const BUNDLED_HELPERS = Object.freeze([
  {
    name: 'skill-helper',
    id: '@agnes/skill-helper',
    version: '0.1.1',
    license: 'MIT',
    ref: BUNDLED_SKILL_HELPER_REF,
  },
  {
    name: 'mcp-helper',
    id: '@agnes/mcp-helper',
    version: '0.1.0',
    license: 'Apache-2.0',
    ref: 'file:./bundled-plugins/mcp-helper',
  },
  {
    name: 'plugin-helper',
    id: '@agnes/plugin-helper',
    version: '0.1.1',
    license: 'Apache-2.0',
    ref: 'file:./bundled-plugins/plugin-helper',
  },
  {
    name: 'document-reader',
    id: '@agnes/document-reader',
    version: '0.1.2',
    license: 'Apache-2.0',
    ref: 'file:./bundled-plugins/document-reader',
  },
  {
    name: 'agnes-science',
    id: '@agnes/agnes-science',
    version: '0.35.2',
    license: 'Apache-2.0',
    ref: BUNDLED_AGNES_SCIENCE_REF,
  },
  {
    name: 'research-verifier',
    id: '@agnes/research-verifier',
    version: '0.1.0',
    license: 'Apache-2.0',
    ref: BUNDLED_RESEARCH_VERIFIER_REF,
  },
])

/** Only this reserved identity is runtime-owned; ordinary file sources keep workspace semantics. */
export function bundledPluginSourceRoot(ref: string): string | undefined {
  if (!BUNDLED_HELPERS.some((helper) => helper.ref === ref)) return undefined
  if (process.getBuiltinModule('node:sea').isSea()) return dirname(process.execPath)
  const moduleDir = dirname(fileURLToPath(import.meta.url))
  return typeof AGNES_PACKAGED_BUILTINS !== 'undefined' && AGNES_PACKAGED_BUILTINS
    ? moduleDir
    : dirname(moduleDir)
}
