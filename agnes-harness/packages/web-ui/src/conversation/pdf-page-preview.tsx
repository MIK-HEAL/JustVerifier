import { useEffect, useRef, useState } from 'react'

export function PdfPagePreview({ bytes, title }: { bytes?: Uint8Array; title: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const worker = useRef<Worker | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const request = useRef(0)
  const [pages, setPages] = useState(0)
  const [page, setPage] = useState(0)
  const [scale, setScale] = useState(1)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [text, setText] = useState('')
  const [retry, setRetry] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: A user retry must recreate a failed worker even when the authorized bytes are unchanged.
  useEffect(() => {
    setPages(0)
    setPage(0)
    setText('')
    setError('')
    setBusy(true)
    let active = true
    const fail = (message: string) => {
      if (!active) return
      clearTimeout(timer.current)
      worker.current?.terminate()
      worker.current = null
      setError(message)
      setBusy(false)
      setText('')
    }
    if (!bytes?.length || bytes.length > 16 * 1024 * 1024) {
      fail('PDF 资源不可用或超过 16 MiB。')
      return
    }
    try {
      const instance = new Worker('/vendor/pdf-render-worker.js', { type: 'module' })
      worker.current = instance
      instance.onerror = () => fail('PDF 渲染失败，请下载文件查看。')
      instance.onmessage = ({ data }) => {
        if (!active) return
        if (data.type === 'error') {
          fail(data.message)
          return
        }
        if (data.type === 'ready') {
          clearTimeout(timer.current)
          setPages(data.pages)
        } else if (data.type === 'page' && data.id === request.current) {
          clearTimeout(timer.current)
          try {
            const target = canvas.current
            const context = target?.getContext('2d')
            if (!target || !context) throw new Error('Canvas 不可用。')
            target.width = data.width
            target.height = data.height
            context.putImageData(new ImageData(data.pixels, data.width, data.height), 0, 0)
            setText(data.text)
            setBusy(false)
          } catch {
            fail('PDF 页面无法显示，请下载文件查看。')
          }
        }
      }
      timer.current = setTimeout(() => fail('PDF 加载超时，请重试或下载文件。'), 30_000)
      const copy = bytes.slice()
      instance.postMessage({ type: 'open', bytes: copy }, [copy.buffer])
    } catch {
      fail('浏览器不支持 PDF 预览，请下载文件查看。')
    }
    return () => {
      active = false
      clearTimeout(timer.current)
      worker.current?.terminate()
      worker.current = null
    }
  }, [bytes, retry])
  useEffect(() => {
    if (!pages || !worker.current) return
    setBusy(true)
    setText('')
    const id = ++request.current
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      worker.current?.terminate()
      worker.current = null
      setError('PDF 页面渲染超时，请重试或下载文件。')
      setBusy(false)
    }, 15_000)
    worker.current.postMessage({ type: 'page', id, page, scale })
  }, [pages, page, scale])
  return (
    <div className="pdf-page-preview">
      <div className="pdf-page-controls">
        <button type="button" disabled={busy || !!error || page === 0} onClick={() => setPage(page - 1)}>
          上一页
        </button>
        <span>{pages ? `${page + 1} / ${pages}` : 'PDF'}</span>
        <button
          type="button"
          disabled={busy || !!error || page + 1 >= pages}
          onClick={() => setPage(page + 1)}
        >
          下一页
        </button>
        <label>
          PDF 缩放
          <select value={scale} onChange={(e) => setScale(Number(e.target.value))} disabled={!!error}>
            {[0.5, 1, 1.5, 2].map((value) => (
              <option key={value} value={value}>
                {value * 100}%
              </option>
            ))}
          </select>
        </label>
      </div>
      {error ? (
        <p role="alert">
          {error}{' '}
          <button type="button" onClick={() => setRetry(retry + 1)}>
            重试
          </button>
        </p>
      ) : (
        busy && <p role="status">正在渲染 PDF…</p>
      )}
      <div className="pdf-page-canvas-scroll">
        <canvas
          className={`pdf-scale-${scale * 100}`}
          ref={canvas}
          role="img"
          aria-label={`${title} · 第 ${page + 1} 页`}
          hidden={busy || !!error}
        />
      </div>
      {!busy && !error && (
        <details>
          <summary>本页文本</summary>
          <pre>{text || '本页没有可提取文本（扫描件可使用文档读取工具进行 OCR）。'}</pre>
        </details>
      )}
    </div>
  )
}
