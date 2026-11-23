import type {
  BackgroundRequest,
  BackgroundResponseMap,
  ContentRequest,
  MessageResponse,
  LocatorValidationResult,
  PageInfo,
  ValidationRequestItem,
} from '../types'
import { errorMessage, friendlyTabError } from '../utils'

/** Send a typed request to the background worker and unwrap its response. */
export async function sendToBackground<R extends BackgroundRequest>(
  request: R,
): Promise<BackgroundResponseMap[R['type']]> {
  const response = (await chrome.runtime.sendMessage(request)) as
    | MessageResponse<BackgroundResponseMap[R['type']]>
    | undefined
  if (!response) throw new Error('No response from the background worker.')
  if (!response.ok) throw new Error(response.error)
  return response.data
}

/** Send a typed request to the content script running in a tab. */
export async function sendToContent<T>(tabId: number, request: ContentRequest): Promise<T> {
  const response = (await chrome.tabs.sendMessage(tabId, request)) as MessageResponse<T> | undefined
  if (!response) throw new Error('No response from the page.')
  if (!response.ok) throw new Error(response.error)
  return response.data
}

/**
 * Wrap an async handler as a chrome.runtime.onMessage listener that always
 * replies with a MessageResponse and keeps the channel open for async work.
 */
export function respondWith<M>(handler: (message: M, sender: chrome.runtime.MessageSender) => Promise<unknown>) {
  return (message: M, sender: chrome.runtime.MessageSender, sendResponse: (r: MessageResponse<unknown>) => void) => {
    ;(async () => {
      try {
        sendResponse({ ok: true, data: await handler(message, sender) })
      } catch (err) {
        sendResponse({ ok: false, error: errorMessage(err) })
      }
    })()
    return true
  }
}

/** Active tab in the current window. Popup-only: activeTab grants url/title after the action click. */
export async function getActiveTab(): Promise<PageInfo | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (tab?.id === undefined) return null
  return { tabId: tab.id, url: tab.url ?? '', title: tab.title ?? '', favIconUrl: tab.favIconUrl }
}

export const startScan = (tabId: number) => sendToBackground({ type: 'START_SCAN', tabId })

/** Validates locator candidates against the live DOM of the scanned tab (read-only). */
export async function validateLocators(
  tabId: number,
  scanId: string,
  items: ValidationRequestItem[],
): Promise<LocatorValidationResult[]> {
  try {
    return await sendToContent<LocatorValidationResult[]>(tabId, { type: 'VALIDATE_LOCATORS', scanId, items })
  } catch (err) {
    throw new Error(friendlyTabError(err))
  }
}

/**
 * Brings the scanned tab to the front and highlights one element in it.
 * Messaging an already-injected content script needs no extra permissions.
 */
export async function highlightElement(tabId: number, scanId: string, elementId: string): Promise<void> {
  try {
    const tab = await chrome.tabs.get(tabId)
    await sendToContent<void>(tabId, { type: 'HIGHLIGHT_ELEMENT', scanId, elementId })
    await chrome.tabs.update(tabId, { active: true })
    await chrome.windows.update(tab.windowId, { focused: true })
  } catch (err) {
    throw new Error(friendlyTabError(err))
  }
}
/** The workspace is the options page (open_in_tab); this reuses an open workspace tab. */
export const openWorkspace = () => chrome.runtime.openOptionsPage()
