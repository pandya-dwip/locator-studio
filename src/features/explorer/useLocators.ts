import { useEffect, useState } from 'react'
import { generateLocatorsAsync } from '../../core/locator-engine'
import type { ElementLocatorResult, ScanResult } from '../../shared/types'
import { errorMessage } from '../../shared/utils'

export interface LocatorState {
  results: Map<string, ElementLocatorResult> | null
  pending: boolean
  error: string | null
}

/**
 * Generates locator candidates for every scanned element, in chunks so the UI
 * stays responsive. Regenerates when the scan or the test id attribute changes.
 * Results stay in memory: they are derived data and would not fit storage quotas.
 */
export function useLocators(result: ScanResult | null | undefined, testIdAttribute: string): LocatorState {
  const [state, setState] = useState<LocatorState>({ results: null, pending: false, error: null })

  useEffect(() => {
    if (!result) {
      setState({ results: null, pending: false, error: null })
      return
    }
    const controller = new AbortController()
    setState((s) => ({ ...s, pending: true, error: null }))
    generateLocatorsAsync(result.elements, { testIdAttribute }, { signal: controller.signal }).then(
      (results) => setState({ results, pending: false, error: null }),
      (err: unknown) => {
        if (!controller.signal.aborted) setState({ results: null, pending: false, error: errorMessage(err) })
      },
    )
    return () => controller.abort()
  }, [result, testIdAttribute])

  return state
}
