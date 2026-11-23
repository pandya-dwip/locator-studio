import { useEffect, useState } from 'react'
import { Crosshair, LoaderCircle, MousePointerClick } from 'lucide-react'
import { CATEGORIES, NAME_SOURCE_LABEL } from '../../shared/constants'
import { highlightElement } from '../../shared/messaging'
import type { ScannedElement, ScanResult } from '../../shared/types'
import { EmptyState } from '../../shared/ui/EmptyState'
import { errorMessage } from '../../shared/utils'
import { ENABLED_LABEL, REASON_LABEL, VISIBILITY_LABEL } from './format'
import { LocatorPanel } from './LocatorPanel'
import type { LocatorState } from './useLocators'

const categoryLabel = (id: string) => CATEGORIES.find((c) => c.id === id)?.label ?? id

interface Props {
  element: ScannedElement | undefined
  result: ScanResult
  locators: LocatorState
  onSelect: (id: string) => void
}

export function ElementDetails({ element: el, result, locators, onSelect }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => setError(null), [el?.id])

  if (!el) {
    return (
      <aside className="el-details">
        <EmptyState icon={MousePointerClick} title="No element selected">
          Select an element to see its attributes, state and structure.
        </EmptyState>
      </aside>
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

  return (
    <aside className="el-details card" aria-label="Element details">
      <header className="el-details-header">
        <code className="el-details-tag">&lt;{el.tagName}&gt;</code>
        <button className="btn" onClick={handleHighlight} disabled={busy || result.tabId === undefined}>
          {busy ? <LoaderCircle size={14} className="spin" /> : <Crosshair size={14} />}
          Highlight on page
        </button>
      </header>
      {error && <p className="error" role="alert">{error}</p>}

      <div className="chips">
        {el.categories.map((c, i) => (
          <span key={c} className={`chip${i === 0 ? ' chip-primary' : ''}`}>{categoryLabel(c)}</span>
        ))}
        {el.hints.map((h) => (
          <span key={h} className="chip chip-hint">{h}</span>
        ))}
      </div>

      <section className="detail-section">
        <h3>Locators</h3>
        <LocatorPanel result={locators.results?.get(el.id)} pending={locators.pending} error={locators.error} />
      </section>

      <Section title="Identity">
        <Field label="Accessible name">
          {el.accessibleName}
          {el.accessibleNameSource && <span className="muted"> · from {NAME_SOURCE_LABEL[el.accessibleNameSource]}</span>}
        </Field>
        <Field label="Role">{el.role && `${el.role} (${el.roleSource})`}</Field>
        <Field label="Text">{el.textContent}</Field>
      </Section>

      <Section title="State">
        <Field label="Visibility">
          <span className="vis-dot" data-vis={el.visibility} /> {VISIBILITY_LABEL[el.visibility]}
          <span className="muted"> · {REASON_LABEL[el.visibilityReason]}</span>
        </Field>
        <Field label="Enabled">{ENABLED_LABEL[el.enabledState]}</Field>
        {properties.map(([k, v]) => (
          <Field key={k} label={k}>{String(v)}</Field>
        ))}
      </Section>

      <Section title={`Attributes (${attributes.length})`}>
        {attributes.length === 0 && <p className="muted">No collected attributes.</p>}
        {attributes.map(([k, v]) => (
          <Field key={k} label={k} mono>{v}</Field>
        ))}
      </Section>

      <Section title="Structure">
        <Field label="Parent">
          {parent ? (
            <button className="link-btn" onClick={() => onSelect(parent.id)}>
              &lt;{parent.tagName}&gt; {parent.accessibleName ?? ''}
            </button>
          ) : (
            el.parentTagName && <code>&lt;{el.parentTagName}&gt;</code>
          )}
        </Field>
        <Field label="Child elements">{String(el.childElementCount)}</Field>
        <Field label="Depth">{String(el.depth)}</Field>
        <Field label="In shadow DOM">{el.inShadowRoot ? 'Yes (open shadow root)' : 'No'}</Field>
        <Field label="Custom element">{el.isCustomElement ? 'Yes' : 'No'}</Field>
      </Section>
    </aside>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="detail-section">
      <h3>{title}</h3>
      <dl>{children}</dl>
    </section>
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
