import type { AccessibleNameSource, ElementCategory, Settings } from '../types'

export const STORAGE_KEYS = {
  scanState: 'scanState',
  /** Full ScanResult of the latest successful scan (can be a few MB). */
  scanResult: 'scanResult',
  settings: 'settings',
} as const

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  language: 'typescript',
  testIdAttribute: 'data-testid',
}

/**
 * Hard limits that keep a scan fast and its result within chrome.storage.local's
 * 10 MB quota (~500 bytes per element on average).
 */
export const SCAN_LIMITS = {
  maxElements: 5000,
  maxTextLength: 200,
  maxNameLength: 150,
  maxAttributeLength: 300,
  maxDataAttributes: 20,
} as const

/** Attributes conventionally used as test hooks (data-testid is Playwright's default). */
export const TEST_ID_ATTRIBUTES = ['data-testid', 'data-test-id', 'data-test', 'data-cy', 'data-qa', 'data-automation-id']

/** Readable names for where an accessible name came from. */
export const NAME_SOURCE_LABEL: Record<AccessibleNameSource, string> = {
  'aria-labelledby': 'aria-labelledby',
  'aria-label': 'aria-label',
  label: '<label>',
  'button-value': 'value',
  alt: 'alt',
  caption: 'caption/legend',
  content: 'text content',
  title: 'title',
  placeholder: 'placeholder',
}

/** Display order and labels for categories. */
export const CATEGORIES: { id: ElementCategory; label: string }[] = [
  { id: 'interactive', label: 'Interactive' },
  { id: 'form', label: 'Form' },
  { id: 'navigation', label: 'Navigation' },
  { id: 'text', label: 'Text' },
  { id: 'media', label: 'Media' },
  { id: 'table', label: 'Table' },
  { id: 'list', label: 'List' },
  { id: 'structural', label: 'Structural' },
  { id: 'custom', label: 'Custom' },
]
