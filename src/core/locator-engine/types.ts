// Internal engine types. Public result types live in src/shared/types.
import type { LocatorQuery, LocatorStrategy, ScannedElement, StabilityLevel } from '../../shared/types'

export interface LocatorEngineOptions {
  /** The attribute Playwright's getByTestId() reads (its `testIdAttribute` setting). */
  testIdAttribute: string
}

export const DEFAULT_ENGINE_OPTIONS: LocatorEngineOptions = { testIdAttribute: 'data-testid' }

export interface StrategyContext {
  options: LocatorEngineOptions
  /** All scanned elements by id, for ancestor lookups. */
  byId: Map<string, ScannedElement>
}

/** A strategy's output before batch-level finalisation (ids, sharing, recommendation). */
export interface Candidate {
  /** Unique per element; becomes part of the locator id. */
  key: string
  strategy: LocatorStrategy
  /** Preference order within the same stability level (lower is preferred). */
  rank: number
  expression: string
  /** Data-only equivalent of `expression`, evaluated by the validator. */
  query: LocatorQuery
  displayValue: string
  stability: StabilityLevel
  stabilityReasons: string[]
  sourceAttributes: string[]
  notes: string[]
}

export type Strategy = (el: ScannedElement, ctx: StrategyContext) => Candidate[]
