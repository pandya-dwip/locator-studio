// Text and accessible-name extraction. Bounded: never reads more text than it returns.
import { SCAN_LIMITS } from '../../shared/constants'
import type { AccessibleNameSource } from '../../shared/types'

const SKIP_TEXT = new Set(['script', 'style', 'noscript', 'template', 'textarea', 'select'])

export function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/**
 * The editable region (contenteditable host) containing `el`, if any.
 * Text inside editable regions is user-entered and is never collected.
 */
export function editingHost(el: Element): Element | null {
  const host = el.closest('[contenteditable]')
  if (!host) return null
  const value = host.getAttribute('contenteditable')?.toLowerCase()
  return value === 'false' ? null : host
}

/** Text of the element's direct text-node children only. */
export function ownText(el: Element): string {
  let text = ''
  for (const node of el.childNodes) if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? ''
  return normalize(text)
}

/**
 * Whitespace-normalised text of a subtree, read until `max` characters.
 * Skips scripts, styles, form control contents (textarea defaults, option lists)
 * and editable regions. With `forName`, also skips aria-hidden subtrees and uses
 * image alt text, approximating the accessible-name "name from content" rule.
 */
export function subtreeText(root: Element, max: number, forName = false): string {
  if (editingHost(root)) return ''
  const doc = root.ownerDocument
  const parts: string[] = []
  let length = 0
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT
      const el = node as Element
      if (el !== root && SKIP_TEXT.has(el.localName)) return NodeFilter.FILTER_REJECT
      if (el.hasAttribute('contenteditable') && editingHost(el)) return NodeFilter.FILTER_REJECT
      if (forName && el.getAttribute('aria-hidden') === 'true') return NodeFilter.FILTER_REJECT
      return forName && el.localName === 'img' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
    },
  })
  for (let node = walker.nextNode(); node && length <= max; node = walker.nextNode()) {
    const text = node.nodeType === Node.TEXT_NODE ? node.textContent : (node as Element).getAttribute('alt')
    if (text?.trim()) {
      parts.push(text)
      length += text.length
    }
  }
  return truncate(normalize(parts.join(' ')), max)
}

/** Roles whose accessible name comes from their content. */
const NAME_FROM_CONTENT = new Set([
  'button', 'link', 'heading', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option',
  'treeitem', 'cell', 'gridcell', 'columnheader', 'rowheader', 'checkbox', 'radio', 'switch', 'tooltip',
])

const BUTTON_INPUT_DEFAULTS: Record<string, string> = { submit: 'Submit', reset: 'Reset' }

export interface AccessibleName {
  name: string
  source: AccessibleNameSource
}

/**
 * Approximates the accessible name (accname 1.2) for the common cases:
 * aria-labelledby, aria-label, labels, alt, legend/caption, content, title, placeholder.
 * Also reports where the name came from (getByLabel() is only valid for label sources).
 */
export function accessibleName(el: Element, role: string | undefined): AccessibleName | undefined {
  const max = SCAN_LIMITS.maxNameLength
  const done = (text: string | null | undefined, source: AccessibleNameSource): AccessibleName | undefined => {
    const value = normalize(text ?? '')
    return value ? { name: truncate(value, max), source } : undefined
  }

  const labelledBy = el.getAttribute('aria-labelledby')
  if (labelledBy) {
    const root = el.getRootNode() as Document | ShadowRoot
    const text = labelledBy
      .split(/\s+/)
      .map((id) => root.getElementById?.(id))
      .filter((ref): ref is HTMLElement => !!ref)
      .map((ref) => subtreeText(ref, max, true))
      .join(' ')
    const name = done(text, 'aria-labelledby')
    if (name) return name
  }

  const ariaLabel = done(el.getAttribute('aria-label'), 'aria-label')
  if (ariaLabel) return ariaLabel

  const tag = el.localName
  if (tag === 'input') {
    const input = el as HTMLInputElement
    // For button-like inputs the value attribute is the visible label, not user data.
    if (['button', 'submit', 'reset'].includes(input.type)) {
      return done(el.getAttribute('value') ?? BUTTON_INPUT_DEFAULTS[input.type], 'button-value')
    }
    if (input.type === 'image') return done(el.getAttribute('alt'), 'alt') ?? { name: 'Submit', source: 'button-value' }
  }

  const labels = (el as HTMLInputElement).labels
  if (labels && labels.length > 0) {
    const name = done([...labels].map((l) => subtreeText(l, max, true)).join(' '), 'label')
    if (name) return name
  }

  if (tag === 'img' || tag === 'area') {
    const alt = done(el.getAttribute('alt'), 'alt')
    if (alt) return alt
  }
  if (tag === 'fieldset' || tag === 'table' || tag === 'figure') {
    const caption = el.querySelector(
      tag === 'fieldset' ? ':scope > legend' : tag === 'table' ? ':scope > caption' : ':scope > figcaption',
    )
    const name = caption ? done(subtreeText(caption, max, true), 'caption') : undefined
    if (name) return name
  }
  if ((role && NAME_FROM_CONTENT.has(role)) || tag === 'summary') {
    const name = done(subtreeText(el, max, true), 'content')
    if (name) return name
  }

  return done(el.getAttribute('title'), 'title') ?? done(el.getAttribute('placeholder'), 'placeholder')
}
