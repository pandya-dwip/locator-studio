import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { CircleX, ListTree, LoaderCircle, Search } from 'lucide-react'
import { useScanResult, useScanState, useSettings } from '../../shared/hooks'
import type { ScanResult, ScanState } from '../../shared/types'
import { EmptyState } from '../../shared/ui/EmptyState'
import { ElementDetails } from './ElementDetails'
import { ElementList } from './ElementList'
import { KINDS, elementKind, filterElements, searchText, type ElementKind } from './format'
import { useLocators } from './useLocators'
import './explorer.css'

export function ElementsPage() {
  const state = useScanState()
  const result = useScanResult()
  const { testIdAttribute } = useSettings()
  const locators = useLocators(result, testIdAttribute)
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query) // typing stays responsive on large scans
  const [kind, setKind] = useState<ElementKind | 'all'>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => setSelectedId(null), [result?.scanId])

  const index = useMemo(() => new Map(result?.elements.map((e) => [e.id, searchText(e)])), [result])
  const filtered = useMemo(
    () => (result ? filterElements(result.elements, index, deferredQuery, kind) : []),
    [result, index, deferredQuery, kind],
  )
  const kindCounts = useMemo(() => {
    const counts = new Map<ElementKind, number>()
    for (const e of result?.elements ?? []) counts.set(elementKind(e), (counts.get(elementKind(e)) ?? 0) + 1)
    return counts
  }, [result])
  const selected = useMemo(() => result?.elements.find((e) => e.id === selectedId), [result, selectedId])

  if (result === undefined) return null // loading from storage

  if (!result) {
    return (
      <div className="explorer-empty">
        {state?.status === 'scanning' ? (
          <EmptyState icon={LoaderCircle} title="Scanning…">Extracting elements from the page.</EmptyState>
        ) : state?.status === 'error' ? (
          <EmptyState icon={CircleX} title="Scan failed">{state.error}</EmptyState>
        ) : (
          <EmptyState icon={ListTree} title="No scan yet">
            Open a page, click the Locator Studio toolbar icon and press <strong>Scan page</strong>.
          </EmptyState>
        )}
      </div>
    )
  }

  return (
    <div className="explorer">
      <ScanHeader state={state} result={result} />

      {result.elements.length === 0 ? (
        <div className="explorer-empty">
          <EmptyState icon={ListTree} title="No relevant elements found">
            If the content loads late or lives in an iframe, scan again once it is visible.
          </EmptyState>
        </div>
      ) : (
        <>
        <nav className="kind-tabs" aria-label="Element type">
          <KindTab active={kind === 'all'} onClick={() => setKind('all')} label="All" count={result.elements.length} />
          {KINDS.map((k) => (
            <KindTab key={k.id} active={kind === k.id} onClick={() => setKind(k.id)} label={k.label} count={kindCounts.get(k.id) ?? 0} />
          ))}
        </nav>
        <div className="explorer-body">
          <aside className="explorer-list">
            <div className="list-tools">
              <label className="search">
                <Search size={14} aria-hidden="true" />
                <input
                  type="search"
                  placeholder="Search elements"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Search by tag, id, class, name, text or attribute"
                />
              </label>
              {query && <p className="muted list-count">{filtered.length} match{filtered.length === 1 ? '' : 'es'}</p>}
            </div>
            <ElementList elements={filtered} selectedId={selectedId} onSelect={setSelectedId} showKind={kind === 'all'} />
          </aside>

          <section className="explorer-main">
            <ElementDetails element={selected} result={result} locators={locators} onSelect={setSelectedId} />
          </section>
        </div>
        </>
      )}
    </div>
  )
}

function KindTab({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button type="button" className="kind-tab" aria-pressed={active} onClick={onClick} disabled={count === 0 && !active}>
      {label} <span className="kind-count">{count}</span>
    </button>
  )
}

/** One line: which page was scanned, a few counts, and any scan problems. */
function ScanHeader({ state, result }: { state: ScanState | null; result: ScanResult }) {
  const { summary } = result
  const hidden = summary.byVisibility.hidden + summary.byVisibility['not-rendered']
  return (
    <header className="scan-header">
      <div className="scan-page">
        <h1 className="truncate" title={result.url}>{result.title || result.url}</h1>
        <p className="muted truncate">
          {summary.totalElements} elements · {summary.byVisibility.visible} visible · {hidden} hidden ·{' '}
          {new Date(result.timestamp).toLocaleTimeString()}
          {summary.framesNotScanned > 0 && ` · ${summary.framesNotScanned} iframes not scanned`}
        </p>
      </div>
      {state?.status === 'scanning' && (
        <p className="scan-flag" role="status">
          <LoaderCircle size={14} className="spin" /> Scanning…
        </p>
      )}
      {state?.status === 'error' && (
        <p className="scan-flag scan-flag-error" role="alert" title={state.error}>
          Latest scan failed: {state.error}
        </p>
      )}
      {summary.truncated && (
        <p className="scan-flag scan-flag-warn">Stopped at {summary.elementLimit} elements</p>
      )}
    </header>
  )
}
