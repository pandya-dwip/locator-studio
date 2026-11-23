import { LoaderCircle, Star } from 'lucide-react'
import type { ElementLocatorResult, GeneratedLocator, LocatorStrategy, StabilityLevel } from '../../shared/types'
import { CodeBlock } from '../../shared/ui/CodeBlock'

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

/** All candidates for one element, each with its full expression in a wide code block. */
export function LocatorPanel({ result, pending, error }: Props) {
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

  return (
    <div className="locators">
      <p className="muted loc-note">
        {result.recommendedLocatorId ? '' : `No recommendation: ${result.noRecommendationReason} `}
        Not validated yet: match count and uniqueness have not been checked on the live page.
      </p>
      {result.locators.map((l) => (
        <LocatorItem key={l.id} locator={l} />
      ))}
    </div>
  )
}

function LocatorItem({ locator: l }: { locator: GeneratedLocator }) {
  return (
    <article className={`loc-item${l.isRecommended ? ' loc-item-recommended' : ''}`}>
      <div className="loc-head">
        <span className="loc-strategy">{STRATEGY_LABEL[l.strategy]}</span>
        <span className="stability" data-level={l.stability}>{STABILITY_LABEL[l.stability]}</span>
        {l.isRecommended && (
          <span className="loc-recommended">
            <Star size={12} aria-hidden="true" /> Recommended
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
