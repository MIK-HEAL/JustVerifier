import { ScientificFilePreview } from '@agnes/web-ui/assistant-ui'
import { createElement as h, useEffect, useRef, useState } from 'react'
import { download, loadLibraryFile, unwrap } from './resources.js'

export function apply(ctx) {
  ctx.commands.registerEffect({ id: 'science.library.enqueue', service: 'science.library.enqueue' })
  ctx.slots.register('sidebar.right.tab.guide', (props) => h(Library, { ...props, ctx }), {
    priority: -1,
    select: () => true,
  })
}
const empty = () => ({
  title: '',
  authors: '',
  year: '',
  doi: '',
  journal: '',
  url: '',
  tags: '',
  collection: '',
  notes: '',
})
export function Library({ ctx, sessionId }) {
  const [open, setOpen] = useState(false)
  const [panel, setPanel] = useState('home')
  const [rows, setRows] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [query, setQuery] = useState('')
  const [collection, setCollection] = useState('')
  const [draft, setDraft] = useState(null)
  const [importText, setImportText] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const scope = useRef(null)
  const selected = rows.find((r) => r.id === selectedId)
  useEffect(() => {
    const current = { sessionId: ctx.session.sessionId, stopped: false, busy: false }
    scope.current = current
    setRows([])
    setSelectedId('')
    setPanel('home')
    setDraft(null)
    setImportText('')
    setQuery('')
    setCollection('')
    setStatus('')
    setBusy(false)
    void refresh(current)
    let refreshTimer
    const stop = ctx.session.projection.subscribe(() => {
      clearTimeout(refreshTimer)
      if (!current.busy)
        refreshTimer = setTimeout(() => {
          void refresh(current)
        }, 750)
    })
    return () => {
      current.stopped = true
      clearTimeout(refreshTimer)
      current.wake?.()
      stop()
    }
  }, [ctx, sessionId])
  const alive = (current) =>
    current && !current.stopped && scope.current === current && ctx.session.sessionId === current.sessionId
  async function refresh(current = scope.current) {
    if (!alive(current) || !current.sessionId) return
    const generation = (current.readGeneration ?? 0) + 1
    current.readGeneration = generation
    try {
      const records = []
      let offset = 0
      let output
      do {
        output = unwrap(await ctx.agnes.services.call('science.library.list', { offset }))
        if (!alive(current) || current.readGeneration !== generation) return
        records.push(...output.records)
        if (output.hasMore && output.nextOffset <= offset) throw new Error('文献库分页无效。')
        offset = output.nextOffset
      } while (output.hasMore)
      setRows(records)
    } catch (e) {
      if (alive(current) && current.readGeneration === generation) setStatus(e.message)
    }
  }
  async function mutate(input, upload) {
    const current = scope.current
    if (!alive(current) || current.busy || !current.sessionId) return
    current.busy = true
    setBusy(true)
    setStatus('正在提交文献操作…')
    try {
      let blocks = []
      if (upload) {
        if (upload.size > 16 * 1024 * 1024) throw new Error('附件最大为 16 MiB。')
        const bytes = new Uint8Array(await upload.arrayBuffer())
        if (!alive(current)) return
        let binary = ''
        for (let i = 0; i < bytes.length; i += 8192)
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
        const uploadName = `${crypto.randomUUID()}-${upload.name.slice(-180)}`
        input = { ...input, path: 'session-file://upload', uploadName, filename: upload.name }
        blocks = [
          {
            type: 'file',
            name: uploadName,
            mimeType: upload.type || 'application/octet-stream',
            data: btoa(binary),
          },
        ]
      }
      const accepted = unwrap(await ctx.commands.execute('science.library.enqueue', input))
      if (!alive(current)) return
      setStatus('等待会话执行与文件授权…')
      let dispatchError
      const prompt = `调用 science_library_apply，参数为 ${JSON.stringify({ operationId: accepted.operationId })}，执行文献库已提交的操作。仅报告工具实际结果。`
      void ctx.session.commands.prompt([{ type: 'text', text: prompt }, ...blocks]).catch((e) => {
        dispatchError = e
      })
      const deadline = Date.now() + 180000
      while (alive(current)) {
        if (dispatchError) throw dispatchError
        const receipt = unwrap(
          await ctx.agnes.services.call('science.library.status', { operationId: accepted.operationId }),
        )
        if (!alive(current)) return
        if (receipt.status === 'completed') {
          await refresh(current)
          if (alive(current)) {
            setStatus('已保存')
            setDraft(null)
            setImportText('')
          }
          return
        }
        if (receipt.status === 'failed' || receipt.status === 'unknown')
          throw new Error(receipt.error ?? '操作已过期，请重试。')
        if (Date.now() > deadline) throw new Error('等待超时，请检查会话审批和工具结果，再刷新文献库。')
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, 750)
          current.wake = () => {
            clearTimeout(timer)
            resolve()
          }
        })
      }
    } catch (e) {
      if (alive(current)) setStatus(e.message ?? '文献操作失败')
    } finally {
      current.busy = false
      if (alive(current)) setBusy(false)
    }
  }
  async function exportFile(format, ids) {
    const current = scope.current
    try {
      const output = unwrap(
        await ctx.agnes.services.call('science.library.export', { format, ...(ids ? { ids } : {}) }),
      )
      if (alive(current)) download(output.content, output.mime, output.filename)
    } catch (e) {
      if (alive(current)) setStatus(e.message)
    }
  }
  const filtered = rows.filter(
    (r) =>
      (!collection || r.collection === collection) &&
      [r.title, r.doi, r.authors.join(' '), r.tags.join(' ')]
        .join(' ')
        .toLowerCase()
        .includes(query.toLowerCase()),
  )
  const fileCount = rows.reduce((total, row) => total + row.files.length, 0)
  const versionCount = fileCount
  const collectionCount = new Set(rows.map((row) => row.collection).filter(Boolean)).size
  const pdfCount = rows.reduce(
    (total, row) => total + row.files.filter((file) => file.mime === 'application/pdf').length,
    0,
  )
  const recent = rows.slice(-3).reverse()
  const button = (label, action, disabled = busy) =>
    h('button', { key: label, type: 'button', onClick: action, disabled }, label)
  return h(
    'section',
    { className: 'science-library', 'data-literature-library': true },
    button(`${open ? '▾' : '▸'} 文献库与科研文件 · ${rows.length}`, () => setOpen(!open), false),
    open &&
      h(
        'div',
        { className: 'science-library-body' },
        h(
          'nav',
          { className: 'science-workbench-nav', 'aria-label': '科研工作台分区' },
          ...[
            ['home', '工作台'],
            ['library', '文献库'],
            ['files', '文件与预览'],
          ].map(([value, label]) =>
            h(
              'button',
              {
                key: value,
                type: 'button',
                className: panel === value ? 'is-active' : '',
                'aria-current': panel === value ? 'page' : undefined,
                onClick: () => setPanel(value),
              },
              label,
            ),
          ),
        ),
        panel === 'home' &&
          h(
            'div',
            { className: 'science-panel science-panel-home' },
            h(
              'section',
              { className: 'science-workbench-hero', 'data-science-dashboard': true },
              h(
                'div',
                { className: 'science-workbench-heading' },
                h('span', {}, 'SCIENCE WORKBENCH'),
                h('h3', {}, '科研工作台'),
              ),
              h('p', {}, '在对话旁管理文献、文件版本、数据预览和引用。'),
              h(
                'div',
                { className: 'science-metrics' },
                ...[
                  ['文献', rows.length],
                  ['文件', fileCount],
                  ['版本', versionCount],
                  ['PDF', pdfCount],
                ].map(([label, value]) =>
                  h('div', { key: label }, h('strong', {}, value), h('span', {}, label)),
                ),
              ),
              h(
                'div',
                { className: 'science-quick-actions' },
                h(
                  'button',
                  {
                    type: 'button',
                    onClick: () => {
                      setDraft({ record: empty() })
                      setPanel('library')
                    },
                  },
                  '新增文献',
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    onClick: () => setPanel('library'),
                  },
                  '浏览文献',
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    onClick: () => setPanel('files'),
                  },
                  '查看文件',
                ),
                h('button', { type: 'button', onClick: () => exportFile('bibtex') }, '导出引用'),
              ),
            ),
            h(
              'section',
              { className: 'science-dashboard-cards' },
              h(
                'article',
                {},
                h('strong', {}, 'Literature Library'),
                h('p', {}, `${rows.length} 条文献 · ${collectionCount} 个集合`),
                h('span', {}, '检索标题、作者、DOI 和标签'),
              ),
              h(
                'article',
                {},
                h('strong', {}, '科研文件'),
                h('p', {}, `${fileCount} 个文件 · ${versionCount} 个版本`),
                h('span', {}, 'PDF、表格、结构文件均可预览'),
              ),
              h(
                'article',
                {},
                h('strong', {}, '来源与复用'),
                h('p', {}, 'CSL-JSON · BibTeX · RIS'),
                h('span', {}, '让引用和项目资料保持可迁移'),
              ),
            ),
            h(
              'section',
              { className: 'science-recent', 'aria-label': '最近加入' },
              h(
                'div',
                { className: 'science-section-heading' },
                h('h4', {}, '最近加入'),
                h('span', {}, `${collectionCount} 个集合`),
              ),
              recent.length
                ? recent.map((row) =>
                    h(
                      'button',
                      {
                        key: row.id,
                        type: 'button',
                        onClick: () => {
                          setSelectedId(row.id)
                          setPanel('library')
                        },
                      },
                      h('strong', {}, row.title),
                      h('span', {}, `${row.authors.join(', ') || '未填写作者'} · ${row.files.length} 个文件`),
                    ),
                  )
                : h('p', {}, '还没有文献。新增记录或导入 CSL-JSON 后，这里会显示项目最近内容。'),
            ),
          ),
        panel === 'library' &&
          h(
            'div',
            { className: 'science-panel science-panel-library' },
            h('h3', {}, 'Literature Library'),
            h('div', { id: 'science-library-records', className: 'science-library-anchor' }),
            h('p', {}, '项目文献、附件与版本。写入通过当前会话执行；元数据保存在项目目录。'),
            !ctx.session.sessionId && h('p', {}, '请先打开一个会话。'),
            h('input', {
              type: 'search',
              'aria-label': '检索文献',
              placeholder: '标题、作者、DOI、标签',
              value: query,
              onChange: (e) => setQuery(e.target.value),
            }),
            h(
              'select',
              { 'aria-label': '文献集合', value: collection, onChange: (e) => setCollection(e.target.value) },
              h('option', { value: '' }, '全部集合'),
              ...[...new Set(rows.map((r) => r.collection).filter(Boolean))].map((c) =>
                h('option', { key: c, value: c }, c),
              ),
            ),
            h(
              'div',
              { className: 'science-actions' },
              button('新增文献', () => setDraft({ record: empty() })),
              button('刷新', () => refresh()),
            ),
            h(
              'details',
              {},
              h('summary', {}, '导入 CSL-JSON'),
              h('textarea', {
                'aria-label': 'CSL-JSON 内容',
                value: importText,
                placeholder: '[{"title":"…","DOI":"10.…"}]',
                onChange: (e) => setImportText(e.target.value),
              }),
              button(
                '导入文献',
                () => mutate({ action: 'import', content: importText }),
                busy || !importText.trim(),
              ),
            ),
            h(
              'div',
              { className: 'science-actions' },
              ...['bibtex', 'ris', 'csl'].map((format) =>
                button(`导出 ${format.toUpperCase()}`, () => exportFile(format)),
              ),
            ),
            h('p', { role: 'status' }, status),
            draft &&
              h(
                'form',
                {
                  onSubmit: (e) => {
                    e.preventDefault()
                    const split = (value) =>
                      value
                        .split(';')
                        .map((s) => s.trim())
                        .filter(Boolean)
                    void mutate({
                      action: 'save',
                      ...draft,
                      record: {
                        ...draft.record,
                        authors: split(draft.record.authors),
                        tags: split(draft.record.tags),
                      },
                    })
                  },
                },
                ...[
                  ['title', '标题'],
                  ['authors', '作者（用分号分隔）'],
                  ['year', '年份'],
                  ['doi', 'DOI'],
                  ['journal', '期刊'],
                  ['url', '链接'],
                  ['tags', '标签（用分号分隔）'],
                  ['collection', '集合'],
                  ['notes', '备注'],
                ].map(([key, label]) =>
                  h(
                    'label',
                    { key },
                    label,
                    h(key === 'notes' ? 'textarea' : 'input', {
                      required: key === 'title',
                      maxLength: key === 'notes' ? 16000 : 2048,
                      value: draft.record[key],
                      onChange: (e) =>
                        setDraft({
                          ...draft,
                          record: {
                            ...draft.record,
                            [key]: e.target.value,
                          },
                        }),
                    }),
                  ),
                ),
                h('button', { type: 'submit', disabled: busy }, '保存文献'),
                button('取消编辑', () => setDraft(null)),
              ),
            h(
              'ul',
              { className: 'science-records' },
              ...filtered.map((r) =>
                h(
                  'li',
                  { key: r.id },
                  h(
                    'button',
                    {
                      type: 'button',
                      'aria-pressed': selectedId === r.id,
                      onClick: () => {
                        setSelectedId(r.id)
                        setDraft(null)
                      },
                    },
                    h('strong', {}, r.title),
                    h('span', {}, `${r.authors.join(', ')} · ${r.year} · ${r.files.length} 个文件版本`),
                  ),
                ),
              ),
            ),
            !filtered.length && h('p', {}, '还没有匹配的文献。可新增记录或导入 CSL-JSON。'),
            selected &&
              h(
                'article',
                { key: selected.id, className: 'science-record-detail' },
                h('h4', {}, selected.title),
                h('p', {}, selected.doi),
                h('p', {}, selected.notes),
                selected.url &&
                  h(
                    'a',
                    { href: selected.url, target: '_blank', rel: 'noopener noreferrer' },
                    '打开文献链接',
                  ),
                h(
                  'div',
                  { className: 'science-actions' },
                  button('编辑', () =>
                    setDraft({
                      id: selected.id,
                      revision: selected.revision,
                      record: {
                        ...selected,
                        authors: selected.authors.join('; '),
                        tags: selected.tags.join('; '),
                      },
                    }),
                  ),
                  button('删除文献', () => {
                    if (window.confirm('移除这条文献？已有文件与版本记录会保留在项目目录。'))
                      void mutate({ action: 'remove', id: selected.id, revision: selected.revision })
                  }),
                ),
                h(
                  'div',
                  { className: 'science-actions' },
                  ...['bibtex', 'ris', 'csl'].map((format) =>
                    button(`引用 ${format.toUpperCase()}`, () => exportFile(format, [selected.id])),
                  ),
                ),
                h(
                  'label',
                  {},
                  '添加 PDF／数据／结构附件',
                  h('input', {
                    type: 'file',
                    disabled: busy,
                    onChange: (e) => {
                      const file = e.target.files?.[0]
                      e.target.value = ''
                      if (file)
                        void mutate({ action: 'attach', id: selected.id, revision: selected.revision }, file)
                    },
                  }),
                ),
              ),
          ),
        panel === 'files' &&
          h(
            'div',
            { className: 'science-panel science-panel-files' },
            h('h3', {}, '文件与预览'),
            h(
              'p',
              {},
              selected
                ? `当前文献：${selected.title}`
                : '先在文献库选择一条文献，再从这里查看 PDF、表格或分子结构。',
            ),
            selected
              ? h(
                  'div',
                  { className: 'science-file-workbench' },
                  h(
                    'label',
                    {},
                    '添加附件',
                    h('input', {
                      type: 'file',
                      disabled: busy,
                      onChange: (e) => {
                        const file = e.target.files?.[0]
                        e.target.value = ''
                        if (file)
                          void mutate(
                            { action: 'attach', id: selected.id, revision: selected.revision },
                            file,
                          )
                      },
                    }),
                  ),
                  h(FileVersions, { record: selected, ctx, busy, mutate }),
                )
              : h('button', { type: 'button', onClick: () => setPanel('library') }, '去文献库选择记录'),
          ),
      ),
  )
}
export function FileVersions({ record, ctx, busy, mutate }) {
  const [version, setVersion] = useState('')
  const [resource, setResource] = useState(null)
  const [error, setError] = useState('')
  const selected = record.files.find((f) => f.version === version)
  useEffect(() => {
    const controller = new AbortController()
    let loaded
    setResource(null)
    setError('')
    if (selected)
      void loadLibraryFile(ctx, record.id, selected.version, controller.signal)
        .then((r) => {
          if (controller.signal.aborted) r.release()
          else {
            loaded = r
            setResource(r)
          }
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(e.message)
        })
    return () => {
      controller.abort()
      loaded?.release()
    }
  }, [ctx, record.id, selected?.version])
  const groups = [...new Set(record.files.map((f) => f.id))]
  return h(
    'section',
    { className: 'science-file-versions', id: 'science-library-files' },
    h('h4', {}, '文件与不可变版本'),
    ...groups.map((id) => {
      const files = record.files.filter((f) => f.id === id)
      const newest = files.at(-1)
      return h(
        'div',
        { key: id },
        h('strong', {}, newest.name),
        h(
          'select',
          {
            'aria-label': `${newest.name} 版本`,
            value: selected?.id === id ? version : '',
            onChange: (e) => setVersion(e.target.value),
          },
          h('option', { value: '' }, '选择版本并预览'),
          ...files.map((f, i) =>
            h('option', { key: f.version, value: f.version }, `v${i + 1} · ${f.createdAt} · ${f.size} B`),
          ),
        ),
        h(
          'label',
          {},
          '添加新版本',
          h('input', {
            type: 'file',
            disabled: busy,
            onChange: (e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file)
                void mutate({ action: 'attach', id: record.id, revision: record.revision, fileId: id }, file)
            },
          }),
        ),
      )
    }),
    error && h('p', { role: 'alert' }, error),
    selected && !resource && !error && h('p', {}, '正在读取并校验文件…'),
    resource &&
      resource.file.version === selected?.version &&
      h(
        'div',
        {},
        h('p', {}, `SHA256 · ${resource.file.sha256}`),
        h('a', { href: resource.url, download: resource.file.name }, '下载此版本'),
        resource.file.size > 2 * 1024 * 1024 &&
          !['application/pdf', 'image/png', 'image/jpeg'].includes(resource.file.mime)
          ? h('p', {}, '文件较大，请下载查看完整内容。')
          : h(ScientificFilePreview, {
              filename: resource.file.name,
              bytes: resource.bytes,
              mime: resource.file.mime,
              content: resource.content,
              resourceUrl: resource.url,
            }),
      ),
  )
}
