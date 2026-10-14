import { describe, expect, it } from 'vitest'
import { scienceExtensionState } from '../src/science-extension.js'

describe('science extension preset', () => {
  it('reports unavailable when no curated resource is installed', () => {
    expect(scienceExtensionState([], [])).toBe('unavailable')
  })
  it('distinguishes partial activation from fully enabled', () => {
    expect(scienceExtensionState([{ name: 'literature-review', desired: 'enabled' }], [])).toBe('partial')
    expect(
      scienceExtensionState(
        [
          { name: 'literature-review', desired: 'enabled' },
          { name: 'paper-narrative', desired: 'enabled' },
          { name: 'figure-composer', desired: 'enabled' },
          { name: 'figure-style', desired: 'enabled' },
          { name: 'compute-env-setup', desired: 'enabled' },
          { name: 'indication-dossier', desired: 'enabled' },
        ],
        [
          { serverId: 'agnes-science-notebook', desired: 'enabled' },
          { serverId: 'agnes-science-artifacts', desired: 'enabled' },
          { serverId: 'agnes-science-literature', desired: 'enabled' },
          { serverId: 'agnes-science-library', desired: 'enabled' },
        ],
      ),
    ).toBe('enabled')
  })
})
