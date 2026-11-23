// Which scanned elements are noise for someone writing Playwright tests.
// The scanner keeps them (structure is needed for form grouping and anchors);
// the explorer hides them by default and the POM's "All eligible" skips them.
import { elementKind } from './element-kind'
import type { ScannedElement } from './types'

export type NoiseReason = 'hidden' | 'decorative' | 'label' | 'wrapper' | 'layout'

export const NOISE_LABEL: Record<NoiseReason, string> = {
  hidden: 'hidden on the page',
  decorative: 'decorative image or icon',
  label: 'label of a form field (use the field instead)',
  wrapper: 'wrapper that only repeats its link, button or field',
  layout: 'layout container',
}

const ACTIONABLE = new Set(['button', 'link', 'field'])
const norm = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase()

/** Noise reason per element id. Elements not in the map are worth showing. */
export function findNoise(elements: ScannedElement[]): Map<string, NoiseReason> {
  const byId = new Map(elements.map((e) => [e.id, e]))
  const children = new Map<string, ScannedElement[]>()
  for (const e of elements) {
    if (!e.parentId) continue
    const list = children.get(e.parentId)
    if (list) list.push(e)
    else children.set(e.parentId, [e])
  }
  const insideActionable = (e: ScannedElement) => {
    for (let p = e.parentId ? byId.get(e.parentId) : undefined; p; p = p.parentId ? byId.get(p.parentId) : undefined) {
      if (ACTIONABLE.has(elementKind(p))) return true
    }
    return false
  }

  const noise = new Map<string, NoiseReason>()
  for (const e of elements) {
    const kind = elementKind(e)
    const actionable = ACTIONABLE.has(kind)
    // Not rendered at all (closed menus, mobile duplicates). Visually hidden controls
    // (opacity 0 custom checkboxes, 1px inputs) stay: tests still interact with them.
    // Hidden status/error messages stay: they appear later and negative tests assert on them.
    if ((e.visibility === 'not-rendered' || (!actionable && e.visibility === 'hidden')) && !isMessage(e)) {
      noise.set(e.id, 'hidden')
    } else if (kind === 'media' && (!e.accessibleName || e.role === 'presentation' || insideActionable(e))) {
      noise.set(e.id, 'decorative')
    } else if (e.tagName === 'label' || e.tagName === 'legend') {
      noise.set(e.id, 'label')
    } else if (actionable) {
      continue
    } else if (e.hints.includes('test-id')) {
      continue // explicit test hooks are always worth showing
    } else if (isExplainedByContents(e, children)) {
      noise.set(e.id, 'wrapper')
    } else if (kind === 'structure' && !e.textContent) {
      // Containers without text of their own (header, nav, ul, section). Cells and list items with text stay.
      noise.set(e.id, 'layout')
    }
  }
  return noise
}

const MESSAGE_ROLES = new Set(['alert', 'status', 'log', 'alertdialog'])
// Whole words in ids/classes: "error", "form-error", "toast_message" — not "btnSuccess" or "errorless".
const MESSAGE_WORDS = /(^|[\s_-])(error|errors|alert|message|messages|notice|notification|toast|success|warning|invalid|feedback|flash)([\s_-]|$)/i

/** Status, error and toast messages: often hidden until something happens. */
export function isMessage(e: ScannedElement): boolean {
  if (e.role && MESSAGE_ROLES.has(e.role)) return true
  // Buttons, links and fields are never messages, whatever their classes say (btn-success).
  if (ACTIONABLE.has(elementKind(e))) return false
  if (e.attributes['aria-live'] && e.attributes['aria-live'] !== 'off') return true
  // Text is not required: error slots are often empty until something fails.
  return MESSAGE_WORDS.test(`${e.attributes.id ?? ''} ${e.attributes.class ?? ''}`)
}

/**
 * A non-interactive element whose text consists only of the names of the
 * links, buttons, fields and text elements inside it (li > a, a nav <div> of
 * links, td > button). Its contents are the useful elements, not it.
 */
function isExplainedByContents(e: ScannedElement, children: Map<string, ScannedElement[]>): boolean {
  let text = norm(e.textContent ?? e.accessibleName)
  if (!text) return false
  const inner: string[] = []
  const collect = (id: string) => {
    for (const c of children.get(id) ?? []) {
      const kind = elementKind(c)
      const t = norm(c.accessibleName ?? c.textContent)
      if (t && (ACTIONABLE.has(kind) || kind === 'text' || kind === 'media')) inner.push(t)
      collect(c.id)
    }
  }
  collect(e.id)
  if (inner.length === 0) return false
  for (const t of inner.sort((a, b) => b.length - a.length)) text = text.replace(t, ' ')
  // Whatever is left is the element's own text; a few stray characters don't count.
  return (text.match(/[\p{L}\p{N}]/gu) ?? []).length < 3
}
