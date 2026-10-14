/** @vitest-environment happy-dom */

import { DocumentPreview, type DocumentPreviewProps } from '@agnes/web-ui/assistant-ui'
import { act, createElement, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PdfPagePreview } from '../src/conversation/pdf-page-preview.js'
import { parseDataTable, parseMolecule } from '../src/conversation/scientific-data.js'
import { ScientificFilePreview } from '../src/conversation/scientific-file-preview.js'
import { zhT } from './locale.js'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function render(props: DocumentPreviewProps) {
  await act(async () => root.render(createElement(DocumentPreview, { ...props, t: zhT })))
}

it('renders authorized PDF pages, ignores superseded responses and retires workers on replacement', async () => {
  const instances: FakeWorker[] = []
  class FakeWorker {
    onmessage?: (event: { data: unknown }) => void
    onerror?: () => void
    postMessage = vi.fn()
    terminate = vi.fn()
    constructor() {
      instances.push(this)
    }
    emit(data: unknown) {
      this.onmessage?.({ data })
    }
  }
  vi.stubGlobal('Worker', FakeWorker)
  vi.stubGlobal(
    'ImageData',
    class {
      constructor(
        public data: unknown,
        public width: number,
        public height: number,
      ) {}
    },
  )
  const paint = vi.fn()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    putImageData: paint,
  } as unknown as CanvasRenderingContext2D)
  const show = async (bytes: Uint8Array) =>
    act(async () => root.render(createElement(PdfPagePreview, { bytes, title: 'Paper' })))
  await show(new Uint8Array([1, 2]))
  const first = instances[0]
  if (!first) throw new Error('Missing PDF worker')
  expect(first.postMessage.mock.calls[0]?.[0]).toMatchObject({ type: 'open' })
  await act(async () => first.emit({ type: 'ready', pages: 2 }))
  const reply = (id: number, text: string) => ({
    type: 'page',
    id,
    width: 1,
    height: 1,
    pixels: new Uint8ClampedArray([255, 0, 0, 255]),
    text,
  })
  const request = first.postMessage.mock.calls.at(-1)?.[0] as { id: number }
  await act(async () => first.emit(reply(request.id, 'First page')))
  expect(host.textContent).toContain('First page')
  expect(paint).toHaveBeenCalled()
  await act(async () =>
    Array.from(host.querySelectorAll('button'))
      .find((b) => b.textContent === '下一页')
      ?.click(),
  )
  await act(async () => first.emit(reply(request.id, 'Stale page')))
  expect(host.textContent).not.toContain('Stale page')
  const next = first.postMessage.mock.calls.at(-1)?.[0] as { id: number; page: number }
  expect(next.page).toBe(1)
  await act(async () => first.emit(reply(next.id, 'Second page')))
  expect(host.textContent).toContain('Second page')
  await show(new Uint8Array([3]))
  expect(first.terminate).toHaveBeenCalled()
  await act(async () => first.emit(reply(next.id, 'Late old document')))
  expect(host.textContent).not.toContain('Late old document')
  await act(async () => instances[1]?.emit({ type: 'error', message: 'Invalid PDF' }))
  expect(host.querySelector('[role=alert]')?.textContent).toContain('Invalid PDF')
  expect(instances[1]?.terminate).toHaveBeenCalled()
  await render({ kind: 'text', content: 'replacement' })
})

it('terminates a hung PDF worker and refuses oversized files before dispatch', async () => {
  vi.useFakeTimers()
  const terminate = vi.fn(),
    dispatch = vi.fn()
  vi.stubGlobal(
    'Worker',
    class {
      terminate = terminate
      postMessage = dispatch
    },
  )
  await act(async () =>
    root.render(
      createElement(PdfPagePreview, { title: 'Large', bytes: new Uint8Array(16 * 1024 * 1024 + 1) }),
    ),
  )
  expect(dispatch).not.toHaveBeenCalled()
  expect(host.querySelector('[role=alert]')?.textContent).toContain('16 MiB')
  await act(async () =>
    root.render(createElement(PdfPagePreview, { title: 'Hung', bytes: new Uint8Array([1]) })),
  )
  await act(async () => vi.advanceTimersByTime(30_000))
  expect(terminate).toHaveBeenCalled()
  expect(host.querySelector('[role=alert]')?.textContent).toContain('超时')
})

it('previews CSV/TSV and JSON tables with literal cells, quoted multiline values and bounded rows', async () => {
  expect(parseDataTable('name,value\r\n"a,b","one\ntwo"\r\n"a""b",3', 'data.csv').rows).toEqual([
    ['a,b', 'one\ntwo'],
    ['a"b', '3'],
  ])
  expect(parseDataTable('a\tb\n1\t2', 'data.tsv').rows).toEqual([['1', '2']])
  expect(parseDataTable('[{"a":1},{"b":2}]', 'data.json')).toMatchObject({
    columns: ['a', 'b'],
    rows: [
      ['1', ''],
      ['', '2'],
    ],
  })
  expect(
    parseDataTable(`a\n${Array.from({ length: 250 }, (_, i) => i).join('\n')}`, 'data.csv'),
  ).toMatchObject({ truncated: true })
  expect(() => parseDataTable('a\n"broken', 'data.csv')).toThrow('未闭合')
  await act(async () =>
    root.render(
      createElement(ScientificFilePreview, {
        filename: 'data.csv',
        mime: 'text/csv',
        content: 'name\n<script>literal</script>',
      }),
    ),
  )
  expect(host.querySelector('td')?.textContent).toBe('<script>literal</script>')
  expect(host.querySelector('script')).toBeNull()
})

it('parses structure formats, rejects invalid atoms/bonds and changes the visible molecular view', async () => {
  const xyz = '3\nwater\nO 0 0 0\nH 1 0 0\nH 0 1 0'
  expect(parseMolecule(xyz, 'water.xyz').atoms).toHaveLength(3)
  const mol =
    'water\n\n\n  2  1  0  0  0  0            999 V2000\n    0.0000    0.0000    0.0000 O   0  0\n    1.0000    0.0000    0.0000 H   0  0\n  1  2  1  0\nM  END\n$$$$'
  expect(parseMolecule(mol, 'water.sdf').bonds).toEqual([[0, 1, 1]])
  expect(
    parseMolecule(
      'HETATM    1  O   HOH A   1       0.000   0.000   0.000  1.00  0.00           O',
      'water.pdb',
    ).atoms[0]?.element,
  ).toBe('O')
  expect(() => parseMolecule('1\nx\nC NaN 0 0', 'bad.xyz')).toThrow('坐标无效')
  expect(() => parseMolecule(mol.replace('  1  2  1  0', '  1 99  1  0'), 'bad.mol')).toThrow('键索引')
  await act(async () =>
    root.render(
      createElement(ScientificFilePreview, { filename: 'water.xyz', mime: 'chemical/x-xyz', content: xyz }),
    ),
  )
  const before = host.querySelector('svg')?.innerHTML
  const range = host.querySelector<HTMLInputElement>('input[type="range"]')
  if (!range) throw new Error('Missing molecular rotation control')
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(range, '80')
    range.dispatchEvent(new Event('input', { bubbles: true }))
    range.dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(host.querySelectorAll('circle')).toHaveLength(3)
  expect(host.querySelector('svg')?.innerHTML).not.toBe(before)
})

it('renders literal text and code with stable nodes, empty defaults and removable title', async () => {
  await render({ kind: 'text', title: '预览', content: '<script>literal</script>' })
  const preview = host.querySelector('[data-document-preview]')
  const pre = host.querySelector('pre')
  expect(pre?.textContent).toBe('<script>literal</script>')
  expect(preview?.getAttribute('aria-label')).toBe('预览')
  expect(host.querySelector('script')).toBeNull()
  await render({ kind: 'text' })
  expect(host.querySelector('pre')).toBe(pre)
  expect(pre?.textContent).toBe('')
  expect(preview?.hasAttribute('aria-label')).toBe(false)
  await render({ kind: 'code', content: '<img src="https://evil.test">' })
  const code = host.querySelector('code')
  expect(code?.textContent).toBe('<img src="https://evil.test">')
  expect(host.querySelector('img')).toBeNull()
  await render({ kind: 'code' })
  expect(host.querySelector('code')).toBe(code)
  expect(code?.textContent).toBe('')
})

it('renders only the existing HTML allowlist, preserving order, table attributes and safe fragments', async () => {
  await render({
    kind: 'html',
    content:
      '<h2 class="heading" title="标题" aria-label="节标题">一</h2><p style="color:red" onclick="evil()">二 <em>强调</em></p><table><tbody><tr><th scope="row" colspan="2" rowspan="3">三</th></tr></tbody></table><a href="#notes">四</a><a href="#bad%GG">五</a><a href="#' +
      'x'.repeat(256) +
      '">六</a><script>script literal</script><svg><a href="https://evil.test">svg literal</a></svg><iframe src="https://evil.test"></iframe><img srcset="https://evil.test" src="https://evil.test"><form><input name="x"></form><a href="javascript:evil()">七</a><a href="data:text/html,evil">八</a>',
  })
  expect(host.querySelector('h2')?.outerHTML).toBe(
    '<h2 class="heading" title="标题" aria-label="节标题">一</h2>',
  )
  expect(host.querySelector('th')?.outerHTML).toBe('<th scope="row" colspan="2" rowspan="3">三</th>')
  expect(host.textContent).toBe('一二 强调三四五六script literalsvg literal七八')
  expect(host.querySelector('script, svg, iframe, img, form, input, [style], [onclick]')).toBeNull()
  expect([...host.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'))).toEqual(['#notes'])
  await render({ kind: 'html' })
  expect(host.querySelector('[data-document-preview]')?.childNodes.length).toBe(0)
})

it.each(['image', 'pdf'] as const)(
  'rejects remote, relative and active %s URLs without creating a loading element',
  async (kind) => {
    for (const resourceUrl of [
      'https://evil.test/file',
      '//evil.test/file',
      '/file',
      'data:text/html,evil',
      'javascript:evil()',
      'file:///tmp/a',
      'not a url',
    ]) {
      await render({ kind, resourceUrl })
      expect(host.querySelector('img, iframe')).toBeNull()
      expect(host.querySelector('[data-preview-error]')?.getAttribute('data-preview-error')).toBe(
        kind === 'image' ? '图片资源未获授权' : 'PDF 资源未获授权',
      )
    }
  },
)

it.each(['image', 'pdf'] as const)(
  'distinguishes missing %s resources and displays delivered object URLs with stable elements',
  async (kind) => {
    // Happy DOM cannot navigate blob iframe URLs; inspect the actual PDF DOM in a detached host.
    if (kind === 'pdf') host.remove()
    for (const resourceUrl of [undefined, '']) {
      await render({ kind, ...(resourceUrl === undefined ? {} : { resourceUrl }) })
      expect(host.querySelector('.document-preview-unavailable')?.textContent).toBe(
        kind === 'image' ? '图片资源不可用' : 'PDF 资源不可用',
      )
      expect(host.querySelector('img, iframe')).toBeNull()
    }
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    await render({ kind, title: '文档', resourceUrl: 'blob:https://example.test/one' })
    const element = host.querySelector('img, iframe')
    expect(element?.getAttribute('src')).toBe('blob:https://example.test/one')
    expect(element?.getAttribute(kind === 'image' ? 'alt' : 'title')).toBe('文档')
    if (kind === 'pdf') expect(element?.getAttribute('sandbox')).toBe('')
    else expect(element?.getAttribute('decoding')).toBe('async')
    expect(host.querySelector('[data-preview-error]')).toBeNull()
    await render({ kind, resourceUrl: 'blob:https://example.test/two' })
    expect(host.querySelector('img, iframe')).toBe(element)
    expect(element?.getAttribute('src')).toBe('blob:https://example.test/two')
    expect(element?.getAttribute(kind === 'image' ? 'alt' : 'title')).toBe(
      kind === 'image' ? '文档图片' : 'PDF 文档',
    )
    await render({ kind: 'text', content: 'next' })
    expect(host.textContent).toBe('next')
    expect(revoke).not.toHaveBeenCalled()
  },
)

it('uses real static Markdown with stable copy controls, safe links, theme and injected callbacks', async () => {
  const onCopy = vi.fn(async () => {})
  const onFragment = vi.fn()
  const source =
    '# 标题\n\n[页内](#notes) ![alt](https://evil.test/image) [bad](javascript:evil())\n\n```ts\nconst x = 1\n```'
  await render({ kind: 'markdown', content: source, theme: 'dark', onCopy, onFragment })
  expect(host.querySelector('h1')?.textContent).toBe('标题')
  expect(host.querySelector('img')).toBeNull()
  expect(host.querySelector('.x-markdown-dark')).not.toBeNull()
  expect([...host.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['#notes'])
  const button = host.querySelector<HTMLButtonElement>('.code-copy')
  expect(button).not.toBeNull()
  button?.focus()
  await render({
    kind: 'markdown',
    title: 'new',
    content: `${source}\n\n末尾`,
    theme: 'dark',
    onCopy,
    onFragment,
  })
  expect(host.querySelector('.code-copy')).toBe(button)
  expect(document.activeElement).toBe(button)
  await act(async () => button?.click())
  expect(onCopy).toHaveBeenCalledWith('const x = 1')
  await act(async () => button?.blur())
  expect(host.textContent).toContain('末尾')
  await act(async () => host.querySelector<HTMLAnchorElement>('a')?.click())
  expect(onFragment).toHaveBeenCalledWith('notes')
  await render({ kind: 'markdown' })
  expect(host.textContent).toBe('')
})

it('keeps one React DOM owner through strict mount, parent replacement and return without lifecycle warnings', async () => {
  const errors = vi.spyOn(console, 'error')
  function Parent({ show }: { show: boolean }) {
    return show
      ? createElement(DocumentPreview, { kind: 'markdown', content: '# owned' })
      : createElement('strong', null, 'replacement')
  }
  for (const show of [true, false, true, false]) {
    await act(async () => root.render(createElement(StrictMode, null, createElement(Parent, { show }))))
    expect(host.textContent).toBe(show ? 'owned\n' : 'replacement')
  }
  expect(errors.mock.calls).toEqual([])
})

it('retires Markdown copy work and ignores its late completion after format replacement', async () => {
  vi.useFakeTimers()
  let complete: (() => void) | undefined
  const onCopy = () =>
    new Promise<void>((resolve) => {
      complete = resolve
    })
  await render({ kind: 'markdown', content: '```\nold\n```', onCopy })
  const button = host.querySelector<HTMLButtonElement>('.code-copy')
  expect(button).not.toBeNull()
  await act(async () => button?.click())
  await render({ kind: 'text', content: 'new' })
  const timers = vi.getTimerCount()
  await act(async () => complete?.())
  expect(host.textContent).toBe('new')
  expect(vi.getTimerCount()).toBe(timers)
})
