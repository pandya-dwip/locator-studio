import { useEffect, useState } from 'react'
import { Crosshair, LoaderCircle, MousePointerClick, RefreshCw } from 'lucide-react'
import { CATEGORIES, NAME_SOURCE_LABEL } from '../../shared/constants'
import { highlightElement } from '../../shared/messaging'
import type { ScannedElement, ScanResult } from '../../shared/types'
import { EmptyState } from '../../shared/ui/EmptyState'
import { errorMessage } from '../../shared/utils'
import { ENABLED_LABEL, REASON_LABEL, VISIBILITY_LABEL, identifier } from './format'
import { LocatorPanel } from './LocatorPanel'
import type { LocatorState } from './useLocators'
import type { ValidationState } from './useValidation'

const categoryLabel = (id: string) => CATEGORIES.find((c) => c.id === id)?.label ?? id

interface Props {
  element: ScannedElement | undefined
  result: ScanResult
  locators: LocatorState
  validation: ValidationState
  /** Ticked for the Page Object. */
  picked: boolean
  onTogglePicked: (id: string) => void
  onSelect: (id: string) => void
}

/** Main panel: the selected element, its locators, and (collapsed) its raw metadata. */
export function ElementDetails({ element: el, result, locators, validation, picked, onTogglePicked, onSelect }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => setError(null), [el?.id])

  if (!el) {
    return (
      <div className="detail-empty">
        <EmptyState icon={MousePointerClick} title="Select an element">
          Choose an element from the list to see its Playwright locators.
        </EmptyState>
      </div>
    )
  }

  async function handleHighlight() {
    if (!el || result.tabId === undefined) return
    setBusy(true)
    setError(null)
    try {
      await highlightElement(result.tabId, result.scanId, el.id)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const parent = el.parentId ? result.elements.find((e) => e.id === el.parentId) : undefined
  const properties = Object.entries(el.properties).filter(([, v]) => v !== undefined)
  const attributes = Object.entries(el.attributes)
  const title = el.accessibleName ?? el.textContent ?? identifier(el)

  return (
    <article className="detail" aria-label="Selected element">
      <header className="detail-header">
        <div className="detail-title">
          <h2>
            <code>&lt;{el.tagName}&gt;</code>
            {title && <span className="truncate">{title}</span>}
          </h2>
          <p className="muted">
            {categoryLabel(el.category)}
            {el.role && ` · role ${el.role}`} · {VISIBILITY_LABEL[el.visibility]}
            {el.enabledState !== 'not-applicable' && ` · ${ENABLED_LABEL[el.enabledState]}`}
          </p>
        </div>
        <div className="detail-actions">
          <label className="check">
            <input type="checkbox" checked={picked} onChange={() => onTogglePicked(el.id)} />
            In Page Object
          </label>
          <button className="btn" onClick={handleHighlight} disabled={busy || result.tabId === undefined}>
            {busy ? <LoaderCircle size={14} className="spin" /> : <Crosshair size={14} />}
            Highlight on page
          </button>
        </div>
      </header>
      {error && <p className="error" role="alert">{error}</p>}

      <section className="detail-section">
        <div className="section-head">
          <h3>Locators</h3>
          <button
            type="button"
            className="link-btn"
            onClick={() => void validation.validateElements([el.id])}
            disabled={!!validation.running || !locators.results || validation.connection === 'lost' || validation.connection === 'rescanned'}
          >
            <RefreshCw size={12} /> Revalidate
          </button>
        </div>
        <LocatorPanel
          elementId={el.id}
          result={locators.results?.get(el.id)}
          pending={locators.pending}
          error={locators.error}
          validation={validation}
        />
      </section>

      <details className="detail-section detail-more">
        <summary>
          <h3>Element details</h3>
        </summary>
        <dl className="facts">
          <Field label="Accessible name">
            {el.accessibleName}
            {el.accessibleNameSource && <span className="muted"> · from {NAME_SOURCE_LABEL[el.accessibleNameSource]}</span>}
          </Field>
          <Field label="Role">{el.role && `${el.role} (${el.roleSource})`}</Field>
          <Field label="Text">{el.textContent}</Field>
          <Field label="Categories">
            {el.categories.map(categoryLabel).join(', ')}
            {el.hints.length > 0 && <span className="muted"> · hints: {el.hints.join(', ')}</span>}
          </Field>
          <Field label="Visibility">
            {VISIBILITY_LABEL[el.visibility]}
            <span className="muted"> · {REASON_LABEL[el.visibilityReason]}</span>
          </Field>
          <Field label="Enabled">{ENABLED_LABEL[el.enabledState]}</Field>
          {properties.map(([k, v]) => (
            <Field key={k} label={k}>{String(v)}</Field>
          ))}
          <Field label="Parent">
            {parent ? (
              <button className="link-btn" onClick={() => onSelect(parent.id)}>
                &lt;{parent.tagName}&gt; {parent.accessibleName ?? ''}
              </button>
            ) : (
              el.parentTagName && <code>&lt;{el.parentTagName}&gt;</code>
            )}
          </Field>
          <Field label="Structure">
            {el.childElementCount} child elements · depth {el.depth}
            {el.inShadowRoot && ' · in open shadow root'}
            {el.isCustomElement && ' · custom element'}
          </Field>
        </dl>
        <h4 className="facts-title">Attributes ({attributes.length})</h4>
        {attributes.length === 0 ? (
          <p className="muted">No collected attributes.</p>
        ) : (
          <dl className="facts">
            {attributes.map(([k, v]) => (
              <Field key={k} label={k} mono>{v}</Field>
            ))}
          </dl>
        )}
      </details>
    </article>
  )
}

/** Renders page-derived values as plain text (React escapes them); empty values show a dash. */
function Field({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className={mono ? 'mono' : undefined}>{children || <span className="muted">—</span>}</dd>
    </>
  )
}
