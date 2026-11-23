// Locator Validator: runs candidates against the live DOM and compares the
// result with the element that was originally scanned. Read-only: it never
// clicks, types, scrolls or mutates the page.
import type { LocatorValidationResult, ValidationRequestItem, ValidationStatus } from '../../shared/types'
import { errorMessage } from '../../shared/utils'
import { classify } from '../scanner/classify'
import { createLayoutContext, getEnabledState, getVisibility, type LayoutContext } from '../scanner/state'
import { APPROXIMATE_KINDS, InvalidSelectorError, createMatcher, type Matcher } from './matcher'

const KNOWN_KINDS = new Set(['role', 'label', 'placeholder', 'text', 'testid', 'alttext', 'title', 'css', 'xpath'])

const APPROXIMATION_NOTE: Record<string, string> = {
  role: 'Role and accessible name were matched with Locator Studio’s approximation of Playwright’s algorithm. Confirm in a Playwright run.',
  label: 'Label matching approximates Playwright’s getByLabel(). Confirm in a Playwright run.',
  text: 'Text matching approximates Playwright’s getByText(). Confirm in a Playwright run.',
}

/**
 * The live element a scan id refers to, or undefined when it is unknown
 * (garbage-collected, never scanned, or from another snapshot).
 */
export type OriginalLookup = (elementId: string) => Element | undefined

export function validateLocators(
  doc: Document,
  items: ValidationRequestItem[],
  lookupOriginal: OriginalLookup,
): LocatorValidationResult[] {
  const view = doc.defaultView
  if (!view) throw new Error('The document has no window.')
  // Fresh indexes per request: the DOM may have changed since the last one.
  const matcher = createMatcher(doc)
  const layout = createLayoutContext(view)
  return items.map((item) => {
    try {
      return validateOne(item, matcher, layout, lookupOriginal)
    } catch (err) {
      return result(item, 'error', 0, `Validation failed: ${errorMessage(err)}`)
    }
  })
}

function result(
  item: ValidationRequestItem,
  status: ValidationStatus,
  matchCount: number,
  message: string,
  extra: Partial<LocatorValidationResult> = {},
): LocatorValidationResult {
  return {
    locatorId: item.locatorId,
    elementId: item.elementId,
    expression: item.expression,
    status,
    matchCount,
    isUnique: matchCount === 1,
    approximate: false,
    message,
    warnings: [],
    validatedAt: Date.now(),
    ...extra,
  }
}

function validateOne(
  item: ValidationRequestItem,
  matcher: Matcher,
  layout: LayoutContext,
  lookupOriginal: OriginalLookup,
): LocatorValidationResult {
  const kind = item.query?.kind
  if (!kind || !KNOWN_KINDS.has(kind)) {
    return result(item, 'unsupported', 0, 'This locator type cannot be checked in the browser.')
  }

  let matches: Element[]
  try {
    matches = matcher.match(item.query)
  } catch (err) {
    if (err instanceof InvalidSelectorError) {
      return result(item, 'invalid', 0, `Invalid ${kind === 'xpath' ? 'XPath' : 'CSS'} selector: ${err.message}`)
    }
    throw err
  }

  const count = matches.length
  const original = lookupOriginal(item.elementId)
  const originalPresent = !!original && original.isConnected
  const matchesOriginal = originalPresent ? matches.includes(original) : undefined
  // The element an action would hit: the single match, or the scanned element among several.
  const subject = count === 1 ? matches[0] : matchesOriginal ? original : undefined

  const approximate = APPROXIMATE_KINDS.has(kind)
  const warnings: string[] = approximate ? [APPROXIMATION_NOTE[kind]!] : []
  let isVisible: boolean | undefined
  let isEnabled: boolean | undefined
  if (subject) {
    const v = getVisibility(subject, layout).status
    isVisible = v === 'visible' || v === 'obscured' ? true : v === 'unknown' ? undefined : false
    if (v === 'obscured') warnings.push('The matched element is covered by another element.')
    if (isVisible === false) warnings.push('The matched element is not visible right now.')
    const enabled = getEnabledState(subject, classify(subject)?.categories ?? [])
    isEnabled = enabled === 'not-applicable' || enabled === 'unknown' ? undefined : enabled !== 'disabled'
    if (enabled === 'disabled') warnings.push('The matched element is disabled.')
    if (enabled === 'readonly') warnings.push('The matched element is read-only.')
  }

  const extra = { approximate, warnings, isVisible, isEnabled, matchesOriginalElement: matchesOriginal }
  const plural = (n: number) => `${n} element${n === 1 ? '' : 's'}`

  if (!originalPresent) {
    return result(item, 'stale', count,
      `The scanned element is no longer on the page (removed, re-rendered or the page changed). The locator now matches ${plural(count)}. Scan the page again.`,
      extra)
  }
  if (count === 0) return result(item, 'not-found', 0, 'No element on the page matches this locator.', extra)
  if (count > 1) {
    return result(item, 'multiple', count,
      `${plural(count)} match${matchesOriginal ? ', including the scanned element' : ', but none of them is the scanned element'}. Playwright would reject this locator for actions (strict mode).`,
      extra)
  }
  if (matchesOriginal) return result(item, 'valid', 1, 'Matches exactly one element: the scanned element.', extra)
  const inside = original.contains(matches[0]!)
  return result(item, 'mismatch', 1,
    inside
      ? `Matches one element inside the scanned element (<${matches[0]!.localName}>), not the element itself.`
      : 'Matches exactly one element, but not the scanned element.',
    extra)
}
