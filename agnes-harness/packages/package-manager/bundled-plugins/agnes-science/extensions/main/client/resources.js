export const unwrap = (value) => {
  const output = value?.output ?? value
  if (output?.error) throw new Error(output.error)
  return output
}
/** Project-authorized query, bounded chunk assembly, hash identity and explicit URL lifecycle. */
export async function loadLibraryFile(ctx, recordId, version, signal) {
  const sessionId = ctx.session.sessionId
  const chunks = []
  let file,
    offset = 0
  do {
    signal.throwIfAborted()
    const output = unwrap(
      await ctx.agnes.services.call('science.library.file', { id: recordId, version, offset }),
    )
    signal.throwIfAborted()
    if (ctx.session.sessionId !== sessionId) throw new Error('会话已切换，请重新打开文件。')
    if (
      output.offset !== offset ||
      output.file.version !== version ||
      !/^[a-f0-9]{64}$/.test(output.file.sha256) ||
      !Number.isSafeInteger(output.file.size) ||
      output.file.size < 0 ||
      output.file.size > 16 * 1024 * 1024 ||
      (file &&
        (file.sha256 !== output.file.sha256 ||
          file.size !== output.file.size ||
          file.mime !== output.file.mime ||
          file.name !== output.file.name))
    )
      throw new Error('文件身份不匹配。')
    file = output.file
    const bytes = Uint8Array.from(atob(output.base64), (c) => c.charCodeAt(0))
    if (
      bytes.length > 384 * 1024 ||
      output.nextOffset !== offset + bytes.length ||
      output.nextOffset > file.size ||
      (bytes.length === 0 && offset < file.size)
    )
      throw new Error('文件分块无效。')
    chunks.push(bytes)
    offset = output.nextOffset
  } while (offset < file.size)
  const bytes = new Uint8Array(file.size)
  let at = 0
  for (const chunk of chunks) {
    bytes.set(chunk, at)
    at += chunk.length
  }
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
  signal.throwIfAborted()
  if (hash !== file.sha256 || ctx.session.sessionId !== sessionId)
    throw new Error('文件校验失败，请刷新后重试。')
  const url = URL.createObjectURL(new Blob([bytes], { type: file.mime }))
  return {
    file,
    bytes,
    url,
    content: bytes.length <= 2 * 1024 * 1024 ? new TextDecoder().decode(bytes) : '',
    release: () => URL.revokeObjectURL(url),
  }
}
export function download(content, mime, filename) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
