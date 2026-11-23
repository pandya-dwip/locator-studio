import { DEFAULT_SETTINGS, STORAGE_KEYS } from '../shared/constants'
import type { PageTestData, ScanResult, ScanState, Settings } from '../shared/types'

// All persistence is chrome.storage.local — nothing leaves the machine.

const IDLE: ScanState = { status: 'idle', updatedAt: 0 }

export async function getScanState(): Promise<ScanState> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.scanState)
  return (stored[STORAGE_KEYS.scanState] as ScanState | undefined) ?? IDLE
}

export async function setScanState(state: ScanState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.scanState]: state })
}

export async function getScanResult(): Promise<ScanResult | null> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.scanResult)
  return (stored[STORAGE_KEYS.scanResult] as ScanResult | undefined) ?? null
}

/** Rejects with a quota error if the result exceeds chrome.storage.local's 10 MB limit. */
export async function setScanResult(result: ScanResult): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.scanResult]: result })
}

const TEST_DATA_KEY = 'testData'

/** Test data is kept per page (origin + path), so it survives rescans of the same page. */
export function testDataKey(url: string): string {
  try {
    const u = new URL(url)
    return u.origin + u.pathname
  } catch {
    return url
  }
}

export async function getTestData(pageKey: string): Promise<PageTestData | undefined> {
  const stored = await chrome.storage.local.get(TEST_DATA_KEY)
  return (stored[TEST_DATA_KEY] as Record<string, PageTestData> | undefined)?.[pageKey]
}

export async function setTestData(pageKey: string, data: PageTestData): Promise<void> {
  const stored = await chrome.storage.local.get(TEST_DATA_KEY)
  const all = (stored[TEST_DATA_KEY] as Record<string, PageTestData> | undefined) ?? {}
  await chrome.storage.local.set({ [TEST_DATA_KEY]: { ...all, [pageKey]: data } })
}

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.settings)
  return { ...DEFAULT_SETTINGS, ...(stored[STORAGE_KEYS.settings] as Partial<Settings> | undefined) }
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch }
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: next })
  return next
}

/** Subscribe to changes of one storage key. Returns an unsubscribe function. */
export function watchKey<T>(key: string, callback: (value: T) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && key in changes) callback(changes[key]!.newValue as T)
  }
  chrome.storage.onChanged.addListener(listener)
  return () => chrome.storage.onChanged.removeListener(listener)
}
