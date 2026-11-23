import { useEffect, useState } from 'react'
import { DEFAULT_SETTINGS, STORAGE_KEYS } from './constants'
import type { ScanResult, ScanState, Settings } from './types'
import { getScanResult, getScanState, getSettings, watchKey } from '../storage'

/** Live view of the persisted scan state. */
export function useScanState(): ScanState | null {
  const [state, setState] = useState<ScanState | null>(null)
  useEffect(() => {
    getScanState().then(setState, console.error)
    return watchKey<ScanState>(STORAGE_KEYS.scanState, setState)
  }, [])
  return state
}

/** Live view of the latest stored scan result. undefined while loading, null when none. */
export function useScanResult(): ScanResult | null | undefined {
  const [result, setResult] = useState<ScanResult | null | undefined>(undefined)
  useEffect(() => {
    getScanResult().then(setResult, (err) => {
      console.error(err)
      setResult(null)
    })
    return watchKey<ScanResult | undefined>(STORAGE_KEYS.scanResult, (r) => setResult(r ?? null))
  }, [])
  return result
}

/** Live view of the persisted settings. */
export function useSettings(): Settings {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  useEffect(() => {
    getSettings().then(setSettings, console.error)
    return watchKey<Settings | undefined>(STORAGE_KEYS.settings, (s) => setSettings({ ...DEFAULT_SETTINGS, ...s }))
  }, [])
  return settings
}
