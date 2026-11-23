// Tester-facing grouping of scanned elements (Buttons, Links, Form fields, ...).
// Shared by the explorer tabs and the POM generator.
import type { ScannedElement } from './types'

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
