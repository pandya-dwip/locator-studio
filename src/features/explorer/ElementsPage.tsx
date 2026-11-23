import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { CircleX, ListTree, LoaderCircle, Search, ShieldCheck } from 'lucide-react'
import { useScanResult, useScanState, useSettings } from '../../shared/hooks'
import type { ScanResult, ScanState } from '../../shared/types'
import { EmptyState } from '../../shared/ui/EmptyState'
import { PomPanel, initialPomForm, type PomForm } from '../pom-generator/PomPanel'
import { ElementDetails } from './ElementDetails'
import { ElementList } from './ElementList'
import { KINDS, elementKind, filterElements, searchText, type ElementKind } from './format'
import { useLocators } from './useLocators'
import { useValidation, type ValidationState } from './useValidation'
import './explorer.css'

/** Elements and POM Generator share this page: same list on the left, different main panel. */
export function ElementsPage({ view }: { view: 'elements' | 'pom' }) {
  const state = useScanState()
  const result = useScanResult()
  const { testIdAttribute } = useSettings()
  const locators = useLocators(result, testIdAttribute)
  const validation = useValidation(result, locators.results)
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query) // typing stays responsive on large scans
  const [kind, setKind] = useState<ElementKind | 'all'>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  /** Elements ticked for the Page Object. */
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [pomForm, setPomForm] = useState<PomForm>(initialPomForm)
  const autoValidated = useRef(new Set<string>())

  useEffect(() => {
    setSelectedId(null)
    setPicked(new Set())
    setPomForm(initialPomForm)
    autoValidated.current = new Set()
  }, [result?.scanId])

  // Validate the selected element's candidates once, when it is first opened (read-only DOM queries).
  useEffect(() => {
    if (!selectedId || !locators.results?.has(selectedId) || validation.running || validation.error) return
    if (autoValidated.current.has(selectedId)) return
    autoValidated.current.add(selectedId)
    void validation.validateElements([selectedId])
  }, [selectedId, locators.results, validation])

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

  const openElement = (id: string) => {
    setSelectedId(id)
    if (view === 'pom') location.hash = '#elements'
  }
  const togglePicked = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })
  const allShownPicked = filtered.length > 0 && filtered.every((e) => picked.has(e.id))
  const toggleAllShown = () =>
    setPicked((prev) => {
      const next = new Set(prev)
      for (const e of filtered) {
        if (allShownPicked) next.delete(e.id)
        else next.add(e.id)
      }
      return next
    })

  return (
    <div className="explorer">
      <ScanHeader state={state} result={result} validation={validation} canValidate={!!locators.results} />

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
                <div className="list-meta">
                  <label className="check">
                    <input type="checkbox" checked={allShownPicked} onChange={toggleAllShown} disabled={filtered.length === 0} />
                    Select shown
                  </label>
                  <span className="muted">
                    {picked.size > 0 && `${picked.size} selected · `}
                    {query ? `${filtered.length} match${filtered.length === 1 ? '' : 'es'}` : `${filtered.length} shown`}
                  </span>
                </div>
              </div>
              <ElementList
                elements={filtered}
                selectedId={view === 'elements' ? selectedId : null}
                onSelect={openElement}
                picked={picked}
                onTogglePicked={togglePicked}
                showKind={kind === 'all'}
              />
            </aside>

            <section className="explorer-main">
              {view === 'pom' ? (
                <PomPanel
                  scan={result}
                  locators={locators}
                  validation={validation}
                  picked={picked}
                  form={pomForm}
                  onFormChange={setPomForm}
                />
              ) : (
                <ElementDetails
                  element={selected}
                  result={result}
                  locators={locators}
                  validation={validation}
                  picked={selected ? picked.has(selected.id) : false}
                  onTogglePicked={togglePicked}
                  onSelect={setSelectedId}
                />
              )}
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

/** One line: which page was scanned, a few counts, validation progress and any problems. */
function ScanHeader({
  state,
  result,
  validation,
  canValidate,
}: {
  state: ScanState | null
  result: ScanResult
  validation: ValidationState
  canValidate: boolean
}) {
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
          {validation.validatedElements > 0 && ` · ${validation.validatedElements} element${validation.validatedElements === 1 ? '' : 's'} validated`}
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
      {summary.truncated && <p className="scan-flag scan-flag-warn">Stopped at {summary.elementLimit} elements</p>}
      {validation.error && (
        <p className="scan-flag scan-flag-error" role="alert" title={validation.error}>
          Validation failed: {validation.error}
        </p>
      )}
      {validation.running ? (
        <p className="scan-flag" role="status">
          <LoaderCircle size={14} className="spin" /> Validating {validation.running.done}/{validation.running.total}
        </p>
      ) : (
        <button
          className="btn"
          onClick={() => void validation.validateElements(result.elements.map((e) => e.id))}
          disabled={!canValidate}
          title="Check every locator candidate against the live page"
        >
          <ShieldCheck size={14} /> Validate all
        </button>
      )}
    </header>
  )
}
