// Pure helpers for presenting and searching scanned elements. No React, no chrome.*.
import { TEST_ID_ATTRIBUTES } from '../../shared/constants'
import type {
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

/** What a tester calls the element. Drives the explorer tabs; derived from role and tag only. */
export type ElementKind = 'button' | 'link' | 'field' | 'text' | 'media' | 'structure'

export const KINDS: { id: ElementKind; label: string }[] = [
  { id: 'button', label: 'Buttons' },
  { id: 'link', label: 'Links' },
  { id: 'field', label: 'Form fields' },
  { id: 'text', label: 'Text' },
  { id: 'media', label: 'Media' },
  { id: 'structure', label: 'Structure' },
]

const BUTTON_ROLES = new Set(['button', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'treeitem'])
const FIELD_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'listbox', 'checkbox', 'radio', 'switch', 'slider', 'spinbutton', 'option'])
const FIELD_TAGS = new Set(['input', 'select', 'textarea', 'option', 'optgroup', 'datalist', 'output'])

export function elementKind(el: ScannedElement): ElementKind {
  const role = el.role
  // Checked first: <input type="submit"> and role="tab" are buttons to a tester.
  if ((role && BUTTON_ROLES.has(role)) || el.tagName === 'button' || el.tagName === 'summary') return 'button'
  if (role === 'link' || el.tagName === 'a') return 'link'
  if (FIELD_TAGS.has(el.tagName) || (role && FIELD_ROLES.has(role)) || el.hints.includes('contenteditable')) return 'field'
  if (el.category === 'interactive') return 'button' // clickable without semantics (onclick, tabindex)
  if (el.category === 'text' || el.tagName === 'label' || el.tagName === 'legend') return 'text'
  if (el.category === 'media') return 'media'
  return 'structure'
}

/** Every whitespace-separated term must appear (AND search). */
export function filterElements(
  elements: ScannedElement[],
  index: Map<string, string>,
  query: string,
  kind: ElementKind | 'all',
): ScannedElement[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  return elements.filter((el) => {
    if (kind !== 'all' && elementKind(el) !== kind) return false
    if (terms.length === 0) return true
    const text = index.get(el.id) ?? ''
    return terms.every((t) => text.includes(t))
  })
}
