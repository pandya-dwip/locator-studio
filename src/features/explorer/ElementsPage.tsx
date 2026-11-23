import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { CircleX, ListTree, LoaderCircle, Search } from 'lucide-react'
import { CATEGORIES } from '../../shared/constants'
import { useScanResult, useScanState, useSettings } from '../../shared/hooks'
import type { ElementCategory, ScanResult, ScanState } from '../../shared/types'
import { EmptyState } from '../../shared/ui/EmptyState'
import { ElementDetails } from './ElementDetails'
import { ElementList } from './ElementList'
import { filterElements, searchText } from './format'
import { useLocators } from './useLocators'
import './explorer.css'

export function ElementsPage() {
  const state = useScanState()
  const result = useScanResult()
  const { testIdAttribute } = useSettings()
  const locators = useLocators(result, testIdAttribute)
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query) // typing stays responsive on large scans
  const [category, setCategory] = useState<ElementCategory | 'all'>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => setSelectedId(null), [result?.scanId])

  const index = useMemo(() => new Map(result?.elements.map((e) => [e.id, searchText(e)])), [result])
  const filtered = useMemo(
    () => (result ? filterElements(result.elements, index, deferredQuery, category) : []),
    [result, index, deferredQuery, category],
  )
  const selected = useMemo(() => result?.elements.find((e) => e.id === selectedId), [result, selectedId])

  if (result === undefined) return null // loading from storage

  if (!result) {
    if (state?.status === 'scanning') {
      return <EmptyState icon={LoaderCircle} title="Scanning…">Extracting elements from the page.</EmptyState>
    }
    if (state?.status === 'error') {
      return <EmptyState icon={CircleX} title="Scan failed">{state.error}</EmptyState>
    }
    return (
      <EmptyState icon={ListTree} title="No scan yet">
        Open a page, click the Locator Studio toolbar icon and press <strong>Scan page</strong>. Extracted elements
        appear here.
      </EmptyState>
    )
  }

  return (
    <div className="explorer">
      <ScanBanners state={state} result={result} />
      <SummaryBar result={result} />

      {result.elements.length === 0 ? (
        <EmptyState icon={ListTree} title="No relevant elements found">
          The page has no interactive, form, text or structural elements the scanner recognises. If the content
          loads late or lives in an iframe, scan again once it is visible.
        </EmptyState>
      ) : (
        <>
          <div className="explorer-toolbar">
            <label className="search">
              <Search size={14} aria-hidden="true" />
              <input
                type="search"
                placeholder="Search tag, id, class, name, text, attributes…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search elements"
              />
            </label>
            <div className="filters" role="radiogroup" aria-label="Category filter">
              <FilterChip active={category === 'all'} onClick={() => setCategory('all')}>
                All <span className="count">{result.summary.totalElements}</span>
              </FilterChip>
              {CATEGORIES.filter((c) => result.summary.byCategory[c.id] > 0).map((c) => (
                <FilterChip key={c.id} active={category === c.id} onClick={() => setCategory(c.id)}>
                  {c.label} <span className="count">{result.summary.byCategory[c.id]}</span>
                </FilterChip>
              ))}
            </div>
          </div>

          <p className="muted explorer-count">
            Showing {filtered.length} of {result.summary.totalElements}
          </p>

          <div className="explorer-split">
            <ElementList elements={filtered} selectedId={selectedId} onSelect={setSelectedId} />
            <ElementDetails element={selected} result={result} locators={locators} onSelect={setSelectedId} />
          </div>
        </>
      )}
    </div>
  )
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" role="radio" aria-checked={active} className="filter-chip" onClick={onClick}>
      {children}
    </button>
  )
}

function ScanBanners({ state, result }: { state: ScanState | null; result: ScanResult }) {
  const { summary } = result
  return (
    <>
      {state?.status === 'scanning' && (
        <p className="banner" role="status">
          <LoaderCircle size={14} className="spin" /> Scanning… the list updates when the new scan finishes.
        </p>
      )}
      {state?.status === 'error' && (
        <p className="banner banner-error" role="alert">
          Latest scan failed: {state.error} Showing the previous scan.
        </p>
      )}
      {summary.truncated && (
        <p className="banner banner-warn">
          Stopped at {summary.elementLimit} elements. The rest of the page was not scanned.
        </p>
      )}
    </>
  )
}

function SummaryBar({ result }: { result: ScanResult }) {
  const { summary } = result
  const hidden = summary.byVisibility.hidden + summary.byVisibility['not-rendered']
  const stats: [string, number][] = [
    ['Total', summary.totalElements],
    ['Interactive', summary.byCategory.interactive],
    ['Form', summary.byCategory.form],
    ['Text', summary.byCategory.text],
    ['Structural', summary.byCategory.structural],
    ['Visible', summary.byVisibility.visible],
    ['Hidden', hidden],
  ]
  return (
    <section className="summary card" aria-label="Scan summary">
      <div className="summary-page">
        <span className="truncate" title={result.url}>{result.title || result.url}</span>
        <span className="muted">
          {new Date(result.timestamp).toLocaleString()} · {summary.durationMs} ms
          {summary.byVisibility.obscured > 0 && ` · ${summary.byVisibility.obscured} obscured`}
          {summary.shadowRootsScanned > 0 && ` · ${summary.shadowRootsScanned} shadow roots`}
          {summary.framesNotScanned > 0 && ` · ${summary.framesNotScanned} iframes not scanned`}
          {summary.skippedElements > 0 && ` · ${summary.skippedElements} skipped`}
        </span>
      </div>
      <dl className="summary-stats">
        {stats.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
