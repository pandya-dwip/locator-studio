import { LoaderCircle, Star } from 'lucide-react'
import type {
  ElementLocatorResult,
  GeneratedLocator,
  LocatorStrategy,
  LocatorValidationResult,
  StabilityLevel,
  ValidationStatus,
} from '../../shared/types'
import { chooseLocator } from '../../generators/playwright'
import { CodeBlock } from '../../shared/ui/CodeBlock'
import type { ValidationState } from './useValidation'

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

const STATUS: Record<ValidationStatus, { label: (r: LocatorValidationResult) => string; tone: 'ok' | 'warn' | 'bad' | 'muted' }> = {
  valid: { label: () => 'Unique · correct element', tone: 'ok' },
  multiple: { label: (r) => `${r.matchCount} matches`, tone: 'warn' },
  'not-found': { label: () => 'No match', tone: 'bad' },
  mismatch: { label: () => 'Wrong element', tone: 'bad' },
  invalid: { label: () => 'Invalid selector', tone: 'bad' },
  stale: { label: () => 'Stale', tone: 'warn' },
  error: { label: () => 'Error', tone: 'bad' },
  unsupported: { label: () => 'Not checkable', tone: 'muted' },
}

interface Props {
  elementId: string
  result: ElementLocatorResult | undefined
  pending: boolean
  error: string | null
  validation: ValidationState
}

/** All candidates for one element, each with its full expression and live validation result. */
export function LocatorPanel({ elementId, result, pending, error, validation }: Props) {
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

  // After validation, the marker follows the locator the Page Object would use (same rule).
  const choice = chooseLocator(result, validation.resultFor, false)
  const validatedPick = choice.ok ? choice.locator.id : undefined
  const anyValidated = result.locators.some((l) => validation.resultFor(l))

  return (
    <div className="locators">
      {anyValidated && !validatedPick && <p className="loc-warning">No candidate is confirmed: {!choice.ok && choice.reason}</p>}
      {!result.recommendedLocatorId && <p className="muted loc-note">No recommendation: {result.noRecommendationReason}</p>}
      {result.locators.map((l) => (
        <LocatorItem
          key={l.id}
          locator={l}
          validation={validation.resultFor(l)}
          marker={anyValidated ? (l.id === validatedPick ? 'best' : undefined) : l.isRecommended ? 'recommended' : undefined}
          busy={!!validation.running || validation.connection === 'lost' || validation.connection === 'rescanned'}
          onCheck={() => validation.validateLocator(elementId, l)}
        />
      ))}
    </div>
  )
}

function LocatorItem({
  locator: l,
  validation: v,
  marker,
  busy,
  onCheck,
}: {
  locator: GeneratedLocator
  marker: 'best' | 'recommended' | undefined
  validation: LocatorValidationResult | undefined
  busy: boolean
  onCheck: () => void
}) {
  return (
    <article className="loc-item">
      <div className="loc-head">
        <span className="loc-strategy">{STRATEGY_LABEL[l.strategy]}</span>
        <span className="stability" data-level={l.stability}>{STABILITY_LABEL[l.stability]}</span>
        {marker && (
          <span className="loc-recommended" title={marker === 'best' ? 'Validated and used in the Page Object' : 'Preliminary: not validated yet'}>
            <Star size={12} aria-hidden="true" /> {marker === 'best' ? 'Best validated' : 'Recommended'}
          </span>
        )}
        {l.sharedWith > 0 && (
          <span className="badge" title="The same locator was generated for other scanned elements">
            Shared with {l.sharedWith} other{l.sharedWith > 1 ? 's' : ''}
          </span>
        )}
      </div>
      <div className="loc-body">
        <CodeBlock code={l.expression} compact />
        <div className="val-line">
          {v ? (
            <>
              <span className="val-badge" data-tone={STATUS[v.status].tone}>{STATUS[v.status].label(v)}</span>
              <span className="muted">{facts(v)}</span>
            </>
          ) : (
            <span className="val-badge" data-tone="muted">Not validated</span>
          )}
          <button type="button" className="link-btn val-check" onClick={onCheck} disabled={busy}>
            {v ? 'Recheck' : 'Check'}
          </button>
        </div>
        {v && v.status !== 'valid' && <p className="loc-why">{v.message}</p>}
        {v?.warnings.map((w) => (
          <p key={w} className="loc-why">{w}</p>
        ))}
        <p className="loc-why">
          {l.stabilityReasons.join(' · ')}
          <span className="loc-source"> · Built from {l.sourceAttributes.join(', ')}</span>
        </p>
        {l.notes.map((n) => (
          <p key={n} className="loc-why">{n}</p>
        ))}
      </div>
    </article>
  )
}

/** "1 match · visible · enabled · approximate", only the facts that are known. */
function facts(v: LocatorValidationResult): string {
  const parts = [`${v.matchCount} match${v.matchCount === 1 ? '' : 'es'}`]
  if (v.isVisible !== undefined) parts.push(v.isVisible ? 'visible' : 'hidden')
  if (v.isEnabled !== undefined) parts.push(v.isEnabled ? 'enabled' : 'disabled')
  if (v.matchesOriginalElement === false) parts.push('not the scanned element')
  if (v.approximate) parts.push('approximate check')
  parts.push(new Date(v.validatedAt).toLocaleTimeString())
  return parts.join(' · ')
}
