// Pure helpers for presenting and searching scanned elements. No React, no chrome.*.
import { TEST_ID_ATTRIBUTES } from '../../shared/constants'
import type {
  ElementCategory,
  EnabledStatus,
  ScannedElement,
  VisibilityReason,
  VisibilityStatus,
} from '../../shared/types'

export const VISIBILITY_LABEL: Record<VisibilityStatus, string> = {
  visible: 'Visible',
  hidden: 'Hidden',
  'not-rendered': 'Not rendered',
  obscured: 'Obscured',
  unknown: 'Unknown',
}

export const REASON_LABEL: Record<VisibilityReason, string> = {
  rendered: 'Rendered in the viewport',
  'outside-viewport': 'Rendered, outside the current viewport',
  'display-none': 'display: none',
  'hidden-attribute': 'hidden attribute',
  'ancestor-not-rendered': 'An ancestor is not rendered (display: none, closed <details>, …)',
  'visibility-hidden': 'visibility: hidden / collapse',
  'opacity-zero': 'opacity: 0 (element or ancestor)',
  'zero-size': 'Zero width and height',
  'visually-hidden': '1×1 px box (screen-reader-only pattern)',
  'covered-by-other-element': 'Its centre is covered by another element',
  'inherited-from-select': 'Shown through its <select>',
  'not-measurable': 'No box of its own to measure',
}

export const ENABLED_LABEL: Record<EnabledStatus, string> = {
  enabled: 'Enabled',
  disabled: 'Disabled',
  readonly: 'Read-only',
  'not-applicable': 'Not applicable',
  unknown: 'Unknown',
}

/** Short identifying hint for a row: #id, name, test id or explicit role. */
export function identifier(el: ScannedElement): string | undefined {
  const a = el.attributes
  if (a.id) return `#${a.id}`
  if (a.name) return `name=${a.name}`
  const testAttr = TEST_ID_ATTRIBUTES.find((t) => a[t])
  if (testAttr) return `${testAttr}=${a[testAttr]}`
  if (el.roleSource === 'explicit' && el.role) return `role=${el.role}`
  return undefined
}

/** Lower-cased text searched by the explorer's search box. */
export function searchText(el: ScannedElement): string {
  return [
    el.tagName,
    el.role,
    el.accessibleName,
    el.textContent,
    ...Object.entries(el.attributes).flat(),
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase()
}

/** Every whitespace-separated term must appear (AND search). */
export function filterElements(
  elements: ScannedElement[],
  index: Map<string, string>,
  query: string,
  category: ElementCategory | 'all',
): ScannedElement[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  return elements.filter((el) => {
    if (category !== 'all' && el.category !== category) return false
    if (terms.length === 0) return true
    const text = index.get(el.id) ?? ''
    return terms.every((t) => text.includes(t))
  })
}
