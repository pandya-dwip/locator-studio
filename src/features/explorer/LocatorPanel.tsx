import { useEffect, useState } from 'react'
import { Check, Copy, LoaderCircle, Star } from 'lucide-react'
import type { ElementLocatorResult, GeneratedLocator, LocatorStrategy, StabilityLevel } from '../../shared/types'
import { errorMessage } from '../../shared/utils'

const STRATEGY_LABEL: Record<LocatorStrategy, string> = {
  role: 'Role',
  label: 'Label',
  placeholder: 'Placeholder',
  text: 'Text',
  testid: 'Test ID',
  alttext: 'Alt text',
  title: 'Title',
  css: 'CSS',
  xpath: 'XPath',
}

const STABILITY_LABEL: Record<StabilityLevel, string> = {
  stable: 'Stable',
  moderate: 'Moderate',
  unstable: 'Unstable',
  unknown: 'Unknown',
}

interface Props {
  result: ElementLocatorResult | undefined
  pending: boolean
  error: string | null
}

export function LocatorPanel({ result, pending, error }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  useEffect(() => setSelectedId(result?.locators[0]?.id ?? null), [result])

  if (error) return <p className="error" role="alert">Locator generation failed: {error}</p>
  if (!result) {
    return pending ? (
      <p className="muted loc-pending">
        <LoaderCircle size={14} className="spin" /> Generating locators…
      </p>
    ) : null
  }
  if (result.error) return <p className="error" role="alert">Could not generate locators for this element: {result.error}</p>
  if (result.locators.length === 0) return <p className="muted">{result.noRecommendationReason}</p>

  const selected = result.locators.find((l) => l.id === selectedId) ?? result.locators[0]!

  return (
    <div className="locators">
      {!result.recommendedLocatorId && result.noRecommendationReason && (
        <p className="loc-warning">No recommendation: {result.noRecommendationReason}</p>
      )}
      <div className="loc-list" role="group" aria-label="Locator candidates">
        {result.locators.map((l) => (
          <button
            key={l.id}
            type="button"
            aria-pressed={l.id === selected.id}
            className="loc-row"
            onClick={() => setSelectedId(l.id)}
          >
            <span className="loc-strategy">{STRATEGY_LABEL[l.strategy]}</span>
            <code className="loc-value truncate" title={l.expression}>{l.displayValue}</code>
            {l.isRecommended && <Star size={12} className="loc-star" aria-label="Recommended" />}
            {l.sharedWith > 0 && <span className="badge" title="Also generated for other scanned elements">shared</span>}
            <StabilityPill level={l.stability} />
          </button>
        ))}
      </div>
      <LocatorDetail locator={selected} />
    </div>
  )
}

function StabilityPill({ level }: { level: StabilityLevel }) {
  return <span className="stability" data-level={level}>{STABILITY_LABEL[level]}</span>
}

function LocatorDetail({ locator: l }: { locator: GeneratedLocator }) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)
  useEffect(() => {
    setCopied(false)
    setCopyError(null)
  }, [l.id])

  async function copy() {
    try {
      await navigator.clipboard.writeText(l.expression)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (err) {
      setCopyError(errorMessage(err))
    }
  }

  return (
    <div className="loc-detail">
      <div className="loc-expression">
        <code>{l.expression}</code>
        <button type="button" className="btn loc-copy" onClick={copy} aria-label="Copy expression">
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {copyError && <p className="error" role="alert">Copy failed: {copyError}</p>}

      <dl className="loc-facts">
        <dt>Strategy</dt>
        <dd>
          {STRATEGY_LABEL[l.strategy]}
          {l.isRecommended && <span className="loc-recommended"> · Recommended</span>}
        </dd>
        <dt>Stability</dt>
        <dd>
          <StabilityPill level={l.stability} />
          <ul className="loc-reasons">
            {l.stabilityReasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </dd>
        <dt>Built from</dt>
        <dd className="chips">
          {l.sourceAttributes.map((s) => (
            <span key={s} className="chip chip-hint">{s}</span>
          ))}
        </dd>
        <dt>Uniqueness</dt>
        <dd>
          {l.sharedWith > 0 ? (
            <span className="text-warning">
              Not unique: the same locator was generated for {l.sharedWith} other scanned element{l.sharedWith > 1 ? 's' : ''}.
            </span>
          ) : (
            <span className="muted">Not validated yet. Match count and uniqueness have not been checked on the live page.</span>
          )}
        </dd>
        {l.notes.length > 0 && (
          <>
            <dt>Notes</dt>
            <dd>
              <ul className="loc-reasons">
                {l.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </dd>
          </>
        )}
      </dl>
    </div>
  )
}
