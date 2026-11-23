// Background service worker: routes messages, injects the content script on
// demand and persists scan state. Holds no state in memory (MV3 workers are ephemeral).
import contentScript from '../content/index.ts?iife'
import { respondWith, sendToContent } from '../shared/messaging'
import type { BackgroundRequest, ScanResult, ScanState } from '../shared/types'
import { friendlyTabError } from '../shared/utils'
import { setScanResult, setScanState } from '../storage'

chrome.runtime.onMessage.addListener(
  respondWith<BackgroundRequest>(async (message, sender) => {
    // Only accept requests from our own extension pages.
    if (sender.id !== chrome.runtime.id) throw new Error('Unauthorized sender.')

    switch (message.type) {
      case 'START_SCAN':
        return startScan(message.tabId)
      default:
        throw new Error(`Unknown message: ${JSON.stringify(message)}`)
    }
  }),
)

async function startScan(tabId: number): Promise<ScanState> {
  await setScanState({ status: 'scanning', tabId, updatedAt: Date.now() })
  let state: ScanState
  try {
    // activeTab (granted by the user's toolbar click) authorises this injection.
    await chrome.scripting.executeScript({ target: { tabId }, files: [contentScript] })
    const result = await sendToContent<ScanResult>(tabId, { type: 'SCAN_PAGE' })
    // Store the full result before flipping the state, so watchers of the state find it.
    await setScanResult({ ...result, tabId })
    const { scanId, url, title, summary } = result
    state = { status: 'done', tabId, scanId, url, title, summary, updatedAt: Date.now() }
  } catch (err) {
    state = { status: 'error', tabId, error: friendlyTabError(err), updatedAt: Date.now() }
  }
  await setScanState(state)
  return state
}
