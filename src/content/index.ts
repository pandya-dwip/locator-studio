// Content script: injected on demand into the active tab by the background worker.
// Runs the DOM scanner, keeps the live element registry (never serialized), and
// draws highlights for elements selected in the workspace.
import { scanDocument } from '../core/scanner'
import { respondWith } from '../shared/messaging'
import type { ContentRequest, ScanResult } from '../shared/types'
import { createHighlighter } from './highlight'

interface ContentInstance {
  dispose(): void
}

declare global {
  var __locatorStudio: ContentInstance | undefined
}

// Each scan re-injects this script. Retire the previous instance (which may be
// from an older build after an extension reload) so exactly one listener exists.
try {
  globalThis.__locatorStudio?.dispose()
} catch {
  // The old instance's extension context may already be invalidated.
}

const highlighter = createHighlighter()
let currentScanId = ''
// Weak references: a snapshot must not keep removed nodes alive.
let registry = new Map<string, WeakRef<Element>>()

function scan(): ScanResult {
  highlighter.clear() // never scan our own overlay
  const { result, elements } = scanDocument(document)
  registry = new Map([...elements].map(([id, el]) => [id, new WeakRef(el)]))
  currentScanId = result.scanId
  return result
}

function highlight(scanId: string, elementId: string): void {
  if (scanId !== currentScanId) throw new Error('This page has been rescanned or reloaded since. Scan it again.')
  const el = registry.get(elementId)?.deref()
  if (!el || !el.isConnected) {
    throw new Error('This element is no longer on the page (it was removed or re-rendered). Scan the page again.')
  }
  const id = el.getAttribute('id')
  highlighter.show(el, `${el.localName}${id ? `#${id}` : ''}`)
}

const listener = respondWith<ContentRequest>(async (message, sender) => {
  if (sender.id !== chrome.runtime.id) throw new Error('Unauthorized sender.')
  switch (message.type) {
    case 'SCAN_PAGE':
      return scan()
    case 'HIGHLIGHT_ELEMENT':
      return highlight(message.scanId, message.elementId)
    default:
      throw new Error(`Unknown message: ${JSON.stringify(message)}`)
  }
})

chrome.runtime.onMessage.addListener(listener)

globalThis.__locatorStudio = {
  dispose() {
    highlighter.clear()
    registry.clear()
    chrome.runtime.onMessage.removeListener(listener)
  },
}
