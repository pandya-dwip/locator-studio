// Which locator a generated Page Object uses for an element. Driven by
// validation results: validated-and-correct beats preliminary recommendation.
import type { ElementLocatorResult, GeneratedLocator, LocatorValidationResult } from '../../shared/types'

export type ValidationLookup = (locator: GeneratedLocator) => LocatorValidationResult | undefined

export type LocatorChoice =
  | { ok: true; locator: GeneratedLocator; validation?: LocatorValidationResult; validated: boolean }
  | { ok: false; reason: string }

/** Statuses that prove a locator is wrong for this element on the current page. */
const KNOWN_BAD = new Set(['multiple', 'not-found', 'mismatch', 'invalid', 'stale'])

/**
 * Rules, in order:
 * 1. The first candidate (engine order: recommended, then stability and strategy
 *    preference) validated as unique and matching the scanned element.
 * 2. Only if allowed: the first candidate not known to be wrong (never validated,
 *    unsupported, or validation error), marked as unvalidated.
 * Candidates matching several elements, the wrong element, nothing, or a stale
 * element are never used.
 */
export function chooseLocator(
  result: ElementLocatorResult | undefined,
  validationOf: ValidationLookup,
  allowUnvalidated: boolean,
): LocatorChoice {
  const locators = result?.locators ?? []
  if (locators.length === 0) return { ok: false, reason: 'No locator candidates (not enough identifying information).' }

  const checked = locators.map((locator) => ({ locator, validation: validationOf(locator) }))
  const valid = checked.find((c) => c.validation?.status === 'valid')
  if (valid) return { ok: true, locator: valid.locator, validation: valid.validation, validated: true }

  if (allowUnvalidated) {
    const fallback = checked.find((c) => !c.validation || !KNOWN_BAD.has(c.validation.status))
    if (fallback) return { ok: true, locator: fallback.locator, validation: fallback.validation, validated: false }
  }
  return { ok: false, reason: exclusionReason(checked.map((c) => c.validation)) }
}

function exclusionReason(validations: (LocatorValidationResult | undefined)[]): string {
  const statuses = new Set(validations.map((v) => v?.status))
  if (validations.every((v) => !v)) return 'Not validated yet. Validate locators, or allow unvalidated locators.'
  if (statuses.has('stale')) return 'The scanned element is no longer on the page. Scan the page again.'
  if (statuses.has('multiple')) return 'Every checked candidate matches more than one element.'
  if (statuses.has('mismatch')) return 'The candidates match a different element than the one scanned.'
  if (statuses.has(undefined) || statuses.has('unsupported') || statuses.has('error')) {
    return 'No candidate was confirmed. Validate the remaining candidates, or allow unvalidated locators.'
  }
  return 'No candidate matched the scanned element on the live page.'
}
