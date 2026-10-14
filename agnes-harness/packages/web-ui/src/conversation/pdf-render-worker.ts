import { type PDFiumDocument, PDFiumLibrary } from '@hyzyla/pdfium/browser/base64'

// A dedicated worker receives only verified, authorized bytes. No PDF scripts or forms run.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent) => void) | null
  postMessage: (message: unknown, transfer?: Transferable[]) => void
}
let document: PDFiumDocument | undefined
let library: Awaited<ReturnType<typeof PDFiumLibrary.init>> | undefined
let queue = Promise.resolve()
scope.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try {
      if (data.type === 'open') {
        if (!(data.bytes instanceof Uint8Array) || !data.bytes.length || data.bytes.length > 16 * 1024 * 1024)
          throw new Error('PDF 文件大小无效或超过 16 MiB。')
        document?.destroy()
        library ??= await PDFiumLibrary.init({ disableBase64Warning: true })
        document = await library.loadDocument(data.bytes)
        const pages = document.getPageCount()
        if (pages < 1 || pages > 2000) throw new Error('PDF 页数超过预览限制（2000 页）。')
        scope.postMessage({ type: 'ready', pages })
      } else if (data.type === 'page') {
        if (
          !document ||
          !Number.isInteger(data.page) ||
          data.page < 0 ||
          data.page >= document.getPageCount()
        )
          throw new Error('PDF 页码无效。')
        if (!Number.isFinite(data.scale) || data.scale < 0.5 || data.scale > 2)
          throw new Error('PDF 缩放无效。')
        const page = document.getPage(data.page)
        const { originalWidth: w, originalHeight: h } = page.getOriginalSize()
        if (!Number.isFinite(w * h) || w <= 0 || h <= 0 || w > 20000 || h > 20000)
          throw new Error('PDF 页面尺寸无效。')
        const scale = Math.min(data.scale, Math.sqrt(4_000_000 / (w * h)), 4096 / Math.max(w, h))
        const text = page.getText().slice(0, 100_000)
        const bitmap = await page.render({
          scale,
          render: 'bitmap',
          colorSpace: 'BGRA',
          renderFormFields: false,
        })
        // The wrapper renders with REVERSE_BYTE_ORDER and closes the page after render.
        const pixels = new Uint8ClampedArray(bitmap.data)
        scope.postMessage(
          { type: 'page', id: data.id, width: bitmap.width, height: bitmap.height, pixels, text },
          [pixels.buffer],
        )
      }
    } catch (error) {
      document?.destroy()
      document = undefined
      library?.destroy()
      library = undefined
      scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'PDF 无法预览。' })
    }
  })
}
