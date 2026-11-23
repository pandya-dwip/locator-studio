import { useCallback, useEffect, useRef, useState } from 'react'
import { checkPageConnection, validateLocators, type PageConnection } from '../../shared/messaging'
import type { ElementLocatorResult, GeneratedLocator, LocatorValidationResult, ScanResult, ValidationRequestItem } from '../../shared/types'
import { errorMessage } from '../../shared/utils'

/** Items per message: keeps each content-script call short on large pages. */
const CHUNK = 300

export interface ValidationState {
  /** The result for this exact locator (same id and expression), if validated in this scan. */
  resultFor(locator: GeneratedLocator): LocatorValidationResult | undefined
  /** How many elements have at least one validated candidate. */
  validatedElements: number
  running: { done: number; total: number } | null
  error: string | null
  /** null while checking. Anything but 'connected' means validation cannot work until the page is scanned again. */
  connection: PageConnection | null
  /** Validates every candidate of the given elements against the live page. */
  validateElements(elementIds: string[]): Promise<void>
  validateLocator(elementId: string, locator: GeneratedLocator): Promise<void>
}

/**
 * Live-page validation for the current scan. Results are reset when a new scan
 * arrives, so they are never reused across snapshots.
 */
export function useValidation(scan: ScanResult | null | undefined, locators: Map<string, ElementLocatorResult> | null): ValidationState {
  const [results, setResults] = useState<Map<string, LocatorValidationResult>>(new Map())
  const [running, setRunning] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [connection, setConnection] = useState<PageConnection | null>(null)
  const runId = useRef(0)

  useEffect(() => {
    setConnection(null)
    if (!scan) return
    if (scan.tabId === undefined) {
      setConnection('lost')
      return
    }
    let current = true
    checkPageConnection(scan.tabId, scan.scanId).then((c) => current && setConnection(c))
    return () => {
      current = false
    }
  }, [scan])

  useEffect(() => {
    runId.current++ // cancels any in-flight run for the previous scan
    setResults(new Map())
    setRunning(null)
    setError(null)
  }, [scan?.scanId])

  const run = useCallback(
    async (items: ValidationRequestItem[]) => {
      if (!scan || items.length === 0) return
      if (scan.tabId === undefined) {
        setError('This scan has no tab to validate against. Scan the page again.')
        return
      }
      const id = ++runId.current
      setError(null)
      setRunning({ done: 0, total: items.length })
      try {
        for (let i = 0; i < items.length; i += CHUNK) {
          const batch = await validateLocators(scan.tabId, scan.scanId, items.slice(i, i + CHUNK))
          if (runId.current !== id) return
          setConnection('connected')
          setResults((prev) => {
            const next = new Map(prev)
            for (const r of batch) next.set(r.locatorId, r)
            return next
          })
          setRunning({ done: Math.min(i + CHUNK, items.length), total: items.length })
        }
      } catch (err) {
        if (runId.current === id) {
          setError(errorMessage(err))
          // Distinguish "page unreachable" from other failures for the UI.
          if (scan.tabId !== undefined) setConnection(await checkPageConnection(scan.tabId, scan.scanId))
        }
      } finally {
        if (runId.current === id) setRunning(null)
      }
    },
    [scan],
  )

  const validateElements = useCallback(
    (elementIds: string[]) =>
      run(
        elementIds.flatMap((elementId) =>
          (locators?.get(elementId)?.locators ?? []).map((l) => ({ locatorId: l.id, elementId, expression: l.expression, query: l.query })),
        ),
      ),
    [run, locators],
  )

  const validateLocator = useCallback(
    (elementId: string, l: GeneratedLocator) => run([{ locatorId: l.id, elementId, expression: l.expression, query: l.query }]),
    [run],
  )

  const resultFor = useCallback(
    (l: GeneratedLocator) => {
      const r = results.get(l.id)
      return r && r.expression === l.expression ? r : undefined
    },
    [results],
  )

  const validatedElements = new Set([...results.values()].map((r) => r.elementId)).size

  return { resultFor, validatedElements, running, error, connection, validateElements, validateLocator }
}

/** Shown when the scan can no longer be validated against its page. */
export const DISCONNECTED_HELP = {
  lost: 'The scanned page reloaded or navigated, the tab was closed, or the extension was reloaded after this scan. Validation needs the page exactly as it was scanned: go back to that tab, click the Locator Studio toolbar icon and press Scan page.',
  rescanned: 'This tab has been scanned again since. Reopen the workspace to load the latest scan.',
} as const
