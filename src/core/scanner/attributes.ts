// Curated attribute and property collection. Allow-list based: page attributes are
// untrusted and may carry secrets, so nothing is copied wholesale.
import { SCAN_LIMITS } from '../../shared/constants'
import type { ScannedElement } from '../../shared/types'
import { truncate } from './text'

const ALLOWED = new Set([
  'id', 'class', 'name', 'type', 'role', 'placeholder', 'title', 'alt', 'href', 'src', 'target', 'rel',
  'for', 'tabindex', 'autocomplete', 'required', 'disabled', 'readonly', 'contenteditable', 'hidden',
  'inert', 'multiple', 'open', 'checked', 'selected', 'action', 'method', 'form', 'list', 'min', 'max',
  'minlength', 'maxlength', 'step', 'pattern', 'accept', 'download', 'lang', 'dir', 'scope', 'colspan',
  'rowspan', 'headers', 'size', 'label', 'slot', 'is', 'popover', 'popovertarget', 'accesskey',
  'datetime', 'onclick',
])

/** data-* attribute names that commonly hold secrets or personal data. */
const SENSITIVE_DATA_ATTR = /token|secret|csrf|xsrf|auth|session|passw|nonce|key|email|phone|ssn|card|account|user/i

/** Inputs whose `value` attribute is author markup (a label or a fixed option), never typed text. */
const MARKUP_VALUE_INPUTS = new Set(['button', 'submit', 'reset', 'checkbox', 'radio', 'image'])

function allowsValue(el: Element): boolean {
  const tag = el.localName
  if (tag === 'option' || tag === 'button') return true
  return tag === 'input' && MARKUP_VALUE_INPUTS.has((el as HTMLInputElement).type)
}

export function collectAttributes(el: Element): Record<string, string> {
  const out: Record<string, string> = {}
  let dataCount = 0
  for (const { name, value } of el.attributes) {
    let keep = ALLOWED.has(name) || name.startsWith('aria-')
    if (name.startsWith('data-')) {
      keep = !SENSITIVE_DATA_ATTR.test(name) && dataCount < SCAN_LIMITS.maxDataAttributes
      if (keep) dataCount++
    }
    if (name === 'value') keep = allowsValue(el)
    if (!keep) continue

    let v = value
    if (name === 'onclick') v = '(inline handler)' // record presence, not page code
    else if ((name === 'src' || name === 'href') && v.startsWith('data:')) v = `data:… (${v.length} chars)`
    out[name] = truncate(v, SCAN_LIMITS.maxAttributeLength)
  }
  return out
}

const READONLY_INPUT_TYPES = new Set([
  'text', 'search', 'url', 'tel', 'email', 'password', 'date', 'month', 'week', 'time', 'datetime-local', 'number',
])

/** Native readonly (input/textarea) or aria-readonly. */
export function isReadOnly(el: Element): boolean {
  const tag = el.localName
  const nativeReadonly =
    (tag === 'textarea' || (tag === 'input' && READONLY_INPUT_TYPES.has((el as HTMLInputElement).type))) &&
    el.hasAttribute('readonly')
  return nativeReadonly || el.getAttribute('aria-readonly') === 'true'
}

/** DOM states only. Values (`.value`, typed text) are deliberately never read. */
export function collectProperties(el: Element, contentEditable: boolean): ScannedElement['properties'] {
  const props: ScannedElement['properties'] = {}
  const tag = el.localName
  if (tag === 'input') {
    const input = el as HTMLInputElement
    props.inputType = input.type
    if (input.type === 'checkbox' || input.type === 'radio') props.checked = input.checked
    props.required = input.required
    props.readOnly = isReadOnly(el)
    props.disabled = input.disabled
    if (input.type === 'email' || input.type === 'file') props.multiple = input.multiple
  } else if (tag === 'textarea') {
    const textarea = el as HTMLTextAreaElement
    props.required = textarea.required
    props.readOnly = isReadOnly(el)
    props.disabled = textarea.disabled
  } else if (tag === 'select') {
    const select = el as HTMLSelectElement
    props.required = select.required
    props.disabled = select.disabled
    props.multiple = select.multiple
  } else if (tag === 'option') {
    const option = el as HTMLOptionElement
    props.selected = option.selected
    props.disabled = option.disabled
  } else if (tag === 'button' || tag === 'fieldset' || tag === 'optgroup') {
    props.disabled = (el as HTMLButtonElement).disabled
  }
  if (contentEditable) props.contentEditable = true
  return props
}
