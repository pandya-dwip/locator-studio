import { useCallback, useEffect, useState } from 'react'
import type { PageTestData, TestScenario } from '../../shared/types'
import { errorMessage } from '../../shared/utils'
import { getTestData, setTestData, testDataKey } from '../../storage'

export interface TestDataState {
  /** Saved scenarios per form method. Forms without an entry use suggestions. */
  data: PageTestData
  loaded: boolean
  error: string | null
  setForm(method: string, scenarios: TestScenario[]): void
  /** Forget the user's scenarios for a form (it goes back to suggestions). */
  resetForm(method: string): void
  replaceAll(data: PageTestData): void
}

/** Test data for one page, kept in chrome.storage.local (never sent anywhere). */
export function useTestData(pageUrl: string): TestDataState {
  const key = testDataKey(pageUrl)
  const [data, setData] = useState<PageTestData>({})
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    setLoaded(false)
    getTestData(key).then(
      (d) => {
        if (!current) return
        setData(d ?? {})
        setLoaded(true)
      },
      (err) => current && setError(errorMessage(err)),
    )
    return () => {
      current = false
    }
  }, [key])

  const save = useCallback(
    (next: PageTestData) => {
      setData(next)
      setTestData(key, next).catch((err) => setError(`Could not save test data: ${errorMessage(err)}`))
    },
    [key],
  )

  return {
    data,
    loaded,
    error,
    setForm: (method, scenarios) => save({ ...data, [method]: scenarios }),
    resetForm: (method) => {
      const next = { ...data }
      delete next[method]
      save(next)
    },
    replaceAll: save,
  }
}
