/** Browser-safe projection of the bundled scientific plugin manifest. */
export const OPEN_SCIENCE_MANIFEST = Object.freeze({
  packageId: '@agnes/open-science',
  version: '0.35.1',
  source: 'file:./bundled-plugins/open-science',
  license: 'Apache-2.0',
  skillRootKey: 'package',
  skillScope: 'package',
  mcpServerPrefix: 'open-science-',
})

export type OpenScienceManifest = typeof OPEN_SCIENCE_MANIFEST
