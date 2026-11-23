/** Saves data as a local file from an extension page (no permission, no network). */
export function downloadBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadText(fileName: string, text: string, type = 'text/plain'): void {
  downloadBlob(fileName, new Blob([text], { type: `${type};charset=utf-8` }))
}
