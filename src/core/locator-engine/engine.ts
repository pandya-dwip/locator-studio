// Locator Engine: turns scanned elements into ranked Playwright locator
// candidates. Pure: no DOM, no chrome.*, no React. Validation against the live
// page is a separate step (Locator Validator) and is never simulated here.
import type { ElementLocatorResult, GeneratedLocator, ScannedElement } from '../../shared/types'
import { errorMessage } from '../../shared/utils'
import { cssStrategy, structuralFallback, xpathStrategy } from './strategies/selectors'
import {
  altTextStrategy,
  labelStrategy,
  placeholderStrategy,
  roleStrategy,
  testIdStrategy,
  textStrategy,
  titleStrategy,
} from './strategies/semantic'
import { DEFAULT_ENGINE_OPTIONS, type Candidate, type LocatorEngineOptions, type Strategy, type StrategyContext } from './types'
import { STABILITY_RANK } from './utils/stability'

const STRATEGIES: Strategy[] = [
  testIdStrategy,
  roleStrategy,
  labelStrategy,
  placeholderStrategy,
  altTextStrategy,
  titleStrategy,
  textStrategy,
  cssStrategy,
  xpathStrategy,
]

interface Draft {
  elementId: string
  candidates: Candidate[]
  error?: string
}

function createContext(elements: ScannedElement[], options: LocatorEngineOptions): StrategyContext {
  return { options, byId: new Map(elements.map((e) => [e.id, e])) }
}

/** Candidates for one element. A failure is captured, never thrown. */
function draft(el: ScannedElement, ctx: StrategyContext): Draft {
  try {
    const seen = new Set<string>()
    const candidates: Candidate[] = []
    for (const strategy of STRATEGIES) {
      for (const c of strategy(el, ctx)) {
        if (!seen.has(c.expression)) {
          seen.add(c.expression)
          candidates.push(c)
        }
      }
    }
    // Structural selectors only when nothing better exists.
    if (candidates.length === 0) candidates.push(...structuralFallback(el, ctx))
    return { elementId: el.id, candidates }
  } catch (err) {
    return { elementId: el.id, candidates: [], error: errorMessage(err) }
  }
}

const byPreference = (a: Candidate, b: Candidate) =>
  STABILITY_RANK[a.stability] - STABILITY_RANK[b.stability] || a.rank - b.rank

const RECOMMENDABLE = new Set(['stable', 'moderate'])

/** Batch step: sharing across elements, ordering and recommendation. */
function finalize(drafts: Draft[]): Map<string, ElementLocatorResult> {
  // The same expression generated for two elements cannot identify either uniquely.
  const counts = new Map<string, number>()
  for (const d of drafts) for (const c of d.candidates) counts.set(c.expression, (counts.get(c.expression) ?? 0) + 1)

  const results = new Map<string, ElementLocatorResult>()
  for (const d of drafts) {
    const sorted = [...d.candidates].sort(byPreference)
    const best = sorted.find((c) => RECOMMENDABLE.has(c.stability) && counts.get(c.expression) === 1)
    const ordered = best ? [best, ...sorted.filter((c) => c !== best)] : sorted

    const locators: GeneratedLocator[] = ordered.map((c) => ({
      id: `${d.elementId}:${c.key}`,
      strategy: c.strategy,
      expression: c.expression,
      displayValue: c.displayValue,
      stability: c.stability,
      stabilityReasons: c.stabilityReasons,
      isRecommended: c === best,
      sourceAttributes: c.sourceAttributes,
      notes: c.notes,
      sharedWith: (counts.get(c.expression) ?? 1) - 1,
    }))

    results.set(d.elementId, {
      elementId: d.elementId,
      locators,
      recommendedLocatorId: best ? `${d.elementId}:${best.key}` : undefined,
      noRecommendationReason: best ? undefined : noRecommendationReason(d, locators),
      error: d.error,
    })
  }
  return results
}

function noRecommendationReason(d: Draft, locators: GeneratedLocator[]): string {
  if (d.error) return 'Locator generation failed for this element.'
  if (locators.length === 0) {
    return 'Not enough identifying information: no role with a name, label, placeholder, text, test id or usable attribute.'
  }
  if (locators.some((l) => RECOMMENDABLE.has(l.stability))) {
    return 'Every reasonably stable candidate was also generated for other scanned elements, so none can identify this one on its own.'
  }
  return 'Only unstable candidates (generated values or page structure) are available.'
}

/** Generates candidates for every element synchronously. */
export function generateLocators(
  elements: ScannedElement[],
  options: LocatorEngineOptions = DEFAULT_ENGINE_OPTIONS,
): Map<string, ElementLocatorResult> {
  const ctx = createContext(elements, options)
  return finalize(elements.map((el) => draft(el, ctx)))
}

/**
 * Same result as generateLocators, processed in chunks that yield to the event
 * loop so a large scan never blocks the UI. Rejects with AbortError when aborted.
 */
export async function generateLocatorsAsync(
  elements: ScannedElement[],
  options: LocatorEngineOptions = DEFAULT_ENGINE_OPTIONS,
  { signal, chunkSize = 250 }: { signal?: AbortSignal; chunkSize?: number } = {},
): Promise<Map<string, ElementLocatorResult>> {
  const ctx = createContext(elements, options)
  const drafts: Draft[] = []
  for (let i = 0; i < elements.length; i += chunkSize) {
    signal?.throwIfAborted()
    for (const el of elements.slice(i, i + chunkSize)) drafts.push(draft(el, ctx))
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  signal?.throwIfAborted()
  return finalize(drafts)
}
