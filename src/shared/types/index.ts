export type ScanStatus = 'idle' | 'scanning' | 'done' | 'error'

// ---------------------------------------------------------------------------
// DOM scanner output. Everything here is plain serializable data: no DOM nodes,
// no selectors, no locators (those belong to the future Locator Engine).
// ---------------------------------------------------------------------------

export type ElementCategory =
  | 'interactive'
  | 'form'
  | 'text'
  | 'navigation'
  | 'structural'
  | 'table'
  | 'list'
  | 'media'
  | 'custom'

export type VisibilityStatus = 'visible' | 'hidden' | 'not-rendered' | 'obscured' | 'unknown'

/** Why an element got its visibility status. */
export type VisibilityReason =
  | 'rendered'
  | 'outside-viewport'
  | 'display-none'
  | 'hidden-attribute'
  | 'ancestor-not-rendered'
  | 'visibility-hidden'
  | 'opacity-zero'
  | 'zero-size'
  | 'visually-hidden'
  | 'covered-by-other-element'
  | 'inherited-from-select'
  | 'not-measurable'

export type EnabledStatus = 'enabled' | 'disabled' | 'readonly' | 'not-applicable' | 'unknown'

/** Signals that an element may be interactive without native semantics. */
export type InteractiveHint = 'tabindex' | 'contenteditable' | 'onclick-attribute' | 'test-id'

/** Where an accessible name came from (accname steps, simplified). */
export type AccessibleNameSource =
  | 'aria-labelledby'
  | 'aria-label'
  | 'label'
  | 'button-value'
  | 'alt'
  | 'caption'
  | 'content'
  | 'title'
  | 'placeholder'

export interface ScannedElement {
  /** Handle for this element within one scan snapshot (maps back to the live node in the content script). */
  id: string
  tagName: string
  /** Primary category, used for explorer grouping. */
  category: ElementCategory
  /** All matching categories, primary first. */
  categories: ElementCategory[]
  hints: InteractiveHint[]

  /** Curated attributes. Never contains user-entered values. */
  attributes: Record<string, string>

  /** Truncated, whitespace-normalised text preview. Omitted for containers, form controls and editable regions. */
  textContent?: string
  accessibleName?: string
  accessibleNameSource?: AccessibleNameSource
  /** Explicit `role` attribute, or the implicit ARIA role of the tag. */
  role?: string
  roleSource?: 'explicit' | 'implicit'

  visibility: VisibilityStatus
  visibilityReason: VisibilityReason
  inViewport: boolean
  enabledState: EnabledStatus

  parentTagName?: string
  /** Scan id of the nearest extracted ancestor (flattened across shadow boundaries). */
  parentId?: string
  childElementCount: number
  depth: number
  inShadowRoot: boolean
  isCustomElement: boolean

  properties: {
    inputType?: string
    checked?: boolean
    selected?: boolean
    required?: boolean
    readOnly?: boolean
    disabled?: boolean
    multiple?: boolean
    contentEditable?: boolean
  }
}

// ---------------------------------------------------------------------------
// Locator Engine output. Generated in the workspace from ScannedElement data.
// Generation never claims uniqueness: `validation` is reserved for the
// Locator Validator, which checks candidates against the live page.
// ---------------------------------------------------------------------------

export type LocatorStrategy =
  | 'role'
  | 'label'
  | 'placeholder'
  | 'text'
  | 'testid'
  | 'alttext'
  | 'title'
  | 'css'
  | 'xpath'

/** Expected resilience to page changes. Says nothing about uniqueness. */
export type StabilityLevel = 'stable' | 'moderate' | 'unstable' | 'unknown'

/**
 * Structured, data-only form of a locator. The content script evaluates this
 * against the live DOM; the expression string is never executed.
 */
export type LocatorQuery =
  | { kind: 'role'; role: string; name?: string; exact?: boolean; level?: number }
  | { kind: 'label' | 'placeholder' | 'text' | 'alttext' | 'title'; text: string; exact?: boolean }
  | { kind: 'testid'; attribute: string; value: string }
  | { kind: 'css' | 'xpath'; selector: string }

export interface GeneratedLocator {
  /** `<elementId>:<variant>`, stable for a given scan and settings. */
  id: string
  strategy: LocatorStrategy
  /** Valid Playwright code, e.g. `page.getByRole('button', { name: 'Save' })`. */
  expression: string
  /** Short readable form for lists. */
  displayValue: string
  stability: StabilityLevel
  stabilityReasons: string[]
  isRecommended: boolean
  /** The scanned information the locator was built from. */
  sourceAttributes: string[]
  /** Remarks that are not about stability (matching behaviour, configuration). */
  notes: string[]
  /**
   * Number of other scanned elements for which this exact expression was also
   * generated. > 0 proves the locator is not unique; 0 proves nothing.
   */
  sharedWith: number
  /** What the validator evaluates. Mirrors `expression`. */
  query: LocatorQuery
}

export interface ElementLocatorResult {
  elementId: string
  /** Recommended first, then by stability and strategy preference. */
  locators: GeneratedLocator[]
  recommendedLocatorId?: string
  /** Why nothing was recommended, when nothing was. */
  noRecommendationReason?: string
  /** Generation failed for this element (other elements are unaffected). */
  error?: string
}

export interface ScanSummary {
  totalElements: number
  /** Counts by primary category (sum equals totalElements). */
  byCategory: Record<ElementCategory, number>
  byVisibility: Record<VisibilityStatus, number>
  disabledElements: number
  /** Open shadow roots that were traversed. Closed shadow roots cannot be seen. */
  shadowRootsScanned: number
  /** iframes recorded but whose documents were not scanned (v1 scans the top document only). */
  framesNotScanned: number
  /** Elements that threw during inspection and were skipped. */
  skippedElements: number
  /** True when the element limit was reached. */
  truncated: boolean
  elementLimit: number
  durationMs: number
}

export interface ScanResult {
  scanId: string
  /** Tab the scan came from. Set by the background worker, not the scanner. */
  tabId?: number
  url: string
  title: string
  timestamp: number
  summary: ScanSummary
  elements: ScannedElement[]
}

/** Lightweight scan status shared with the popup. The full result is stored separately. */
export interface ScanState {
  status: ScanStatus
  tabId?: number
  scanId?: string
  url?: string
  title?: string
  summary?: ScanSummary
  error?: string
  updatedAt: number
}

export interface PageInfo {
  tabId: number
  url: string
  title: string
  favIconUrl?: string
}

export type ThemePreference = 'system' | 'light' | 'dark'
export type OutputLanguage = 'typescript' | 'javascript'

export interface Settings {
  theme: ThemePreference
  language: OutputLanguage
  /** Mirrors Playwright's `testIdAttribute`: the attribute getByTestId() reads. */
  testIdAttribute: string
}

/** Messages sent from extension pages (popup, workspace) to the background worker. */
export type BackgroundRequest = { type: 'START_SCAN'; tabId: number }

/** Response payload for each background request type. */
export interface BackgroundResponseMap {
  START_SCAN: ScanState
}

/** Messages sent to the content script in a scanned tab. */
export type ContentRequest =
  | { type: 'SCAN_PAGE' }
  | { type: 'HIGHLIGHT_ELEMENT'; scanId: string; elementId: string }
  | { type: 'VALIDATE_LOCATORS'; scanId: string; items: ValidationRequestItem[] }

// ---------------------------------------------------------------------------
// Locator Validator: results of evaluating candidates against the live page.
// ---------------------------------------------------------------------------

export type ValidationStatus =
  /** Exactly one match, and it is the scanned element. */
  | 'valid'
  | 'multiple'
  | 'not-found'
  /** Exactly one match, but not the scanned element. */
  | 'mismatch'
  /** Selector syntax error. */
  | 'invalid'
  /** The scanned element is gone (removed, replaced or the page changed). */
  | 'stale'
  | 'error'
  | 'unsupported'

export interface ValidationRequestItem {
  locatorId: string
  elementId: string
  expression: string
  query: LocatorQuery
}

export interface LocatorValidationResult {
  locatorId: string
  elementId: string
  /** The expression that was validated (results never apply to a changed locator). */
  expression: string
  status: ValidationStatus
  matchCount: number
  isUnique: boolean
  /** Of the single matched element (or the scanned element when it is among the matches). */
  isVisible?: boolean
  isEnabled?: boolean
  matchesOriginalElement?: boolean
  /** True for role/label/text matching, which approximates Playwright's algorithms. */
  approximate: boolean
  message: string
  warnings: string[]
  validatedAt: number
}

export type MessageResponse<T> = { ok: true; data: T } | { ok: false; error: string }
