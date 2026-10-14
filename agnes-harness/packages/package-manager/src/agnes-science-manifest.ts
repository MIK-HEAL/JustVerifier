/** Browser-safe projection of the bundled scientific plugin manifest. */
export const AGNES_SCIENCE_MANIFEST = Object.freeze({
  packageId: '@agnes/agnes-science',
  version: '0.35.2',
  source: 'file:./bundled-plugins/agnes-science',
  license: 'Apache-2.0',
  skillRootKey: 'package',
  skillScope: 'package',
  mcpServerPrefix: 'agnes-science-',
})

export type AgnesScienceManifest = typeof AGNES_SCIENCE_MANIFEST
