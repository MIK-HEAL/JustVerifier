/** @vitest-environment happy-dom */
import { createElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { mountRegion, PluginList, UiLocaleProvider, type UiLocaleSource } from '../src/index.js'

afterEach(() => {
  document.body.replaceChildren()
})

const listProps = {
  tab: 'installed' as const,
  rows: [],
  loading: false,
  inventoryAuthoritative: true,
  query: '',
  nextCursor: null,
  surfaceLinksOf: () => [],
  runtimeOf: () => undefined,
  primaryActionOf: () => ({ label: 'Open', disabled: false, run: () => undefined }),
  switchDisabledOf: () => false,
  onOpen: () => undefined,
  onToggleDesired: () => undefined,
  onLoadMore: () => undefined,
}

function renderText(element: ReturnType<typeof createElement>): string {
  const host = document.createElement('div')
  document.body.append(host)
  mountRegion(host, element)
  return host.textContent ?? ''
}

describe('plugin list localization', () => {
  it('uses English for the default empty state', () => {
    expect(renderText(createElement(PluginList, listProps))).toContain('No packages are installed')
  })

  it('uses the selected locale for the empty state', () => {
    const source: UiLocaleSource = {
      getSnapshot: () => 'zh-CN',
      getVersion: () => 0,
      subscribe: () => () => undefined,
      t: (key) => key,
      bind: () => (key) => key,
    }
    const text = renderText(createElement(UiLocaleProvider, { source }, createElement(PluginList, listProps)))

    expect(text).toContain('尚未安装插件')
  })

  it('keeps the scientific package actionable without exposing its internal id', () => {
    const element = createElement(PluginList, {
        ...listProps,
        rows: [
          {
            id: '@agnes/open-science',
            version: '0.35.1',
            source: { type: 'file', ref: 'file:./bundled-plugins/open-science' },
            contributions: [{ kind: 'skill', id: 'open-science/alphafold2' }],
            desired: 'disabled',
            actual: 'not-running',
            blockers: [],
            trusted: true,
            capabilityHash: 'sha256-test',
          },
        ],
      } as never)
    const host = document.createElement('div')
    document.body.append(host)
    mountRegion(host, element)
    const text = host.textContent ?? ''

    expect(text).toContain('Scientific tools')
    expect(text).not.toContain('open-science')
    const toggle = host.querySelector<HTMLButtonElement>('button[role="switch"]')
    expect(toggle?.getAttribute('aria-label')).toBe('Request to enable Scientific tools')
    expect(toggle?.disabled).toBe(false)
  })
})
