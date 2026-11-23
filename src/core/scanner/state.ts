// Visibility and enabled-state detection. Each element's computed style is read
// at most once per scan (cached), and layout is only read for rendered elements.
import type { ElementCategory, EnabledStatus, VisibilityReason, VisibilityStatus } from '../../shared/types'
import { isReadOnly } from './attributes'

export interface Visibility {
  status: VisibilityStatus
  reason: VisibilityReason
  inViewport: boolean
}

/** Per-scan cache. Drop it when the scan finishes so no DOM references are retained. */
export interface LayoutContext {
  style(el: Element): CSSStyleDeclaration
  readonly viewportWidth: number
  readonly viewportHeight: number
  readonly visibility: Map<Element, Visibility>
}

export function createLayoutContext(view: Window): LayoutContext {
  const styles = new Map<Element, CSSStyleDeclaration>()
  return {
    style(el) {
      let style = styles.get(el)
      if (!style) {
        style = view.getComputedStyle(el)
        styles.set(el, style)
      }
      return style
    },
    viewportWidth: view.innerWidth,
    viewportHeight: view.innerHeight,
    visibility: new Map(),
  }
}

const result = (status: VisibilityStatus, reason: VisibilityReason, inViewport = false): Visibility => ({
  status,
  reason,
  inViewport,
})

/** Parent in the flat tree: crosses from a shadow root to its host. */
export function flatParent(el: Element): Element | null {
  if (el.parentElement) return el.parentElement
  const root = el.parentNode
  return root && 'host' in root ? (root as ShadowRoot).host : null
}

/** Fallback for environments without Element.checkVisibility (walks ancestors, cached styles). */
function ancestorState(el: Element, ctx: LayoutContext): { notRendered: boolean; transparent: boolean } {
  let transparent = false
  for (let a = flatParent(el); a; a = flatParent(a)) {
    const style = ctx.style(a)
    if (style.display === 'none') return { notRendered: true, transparent }
    if (style.opacity === '0') transparent = true
  }
  return { notRendered: false, transparent }
}

export function getVisibility(el: Element, ctx: LayoutContext): Visibility {
  const cached = ctx.visibility.get(el)
  if (cached) return cached
  const v = computeVisibility(el, ctx)
  ctx.visibility.set(el, v)
  return v
}

function computeVisibility(el: Element, ctx: LayoutContext): Visibility {
  if (!el.isConnected) return result('unknown', 'not-measurable')

  // Options render inside their <select>; they have no box of their own.
  if (el.localName === 'option' || el.localName === 'optgroup') {
    const select = el.closest('select')
    if (select) {
      const v = getVisibility(select, ctx)
      return v.status === 'visible' ? { ...v, reason: 'inherited-from-select' } : v
    }
  }

  const style = ctx.style(el)
  if (style.display === 'none') {
    return result('not-rendered', el.hasAttribute('hidden') ? 'hidden-attribute' : 'display-none')
  }

  const native = typeof el.checkVisibility === 'function'
  const ancestors = native ? null : ancestorState(el, ctx)
  // checkVisibility() covers display:none ancestors, closed <details>, content-visibility:hidden.
  if (native ? !el.checkVisibility() : ancestors!.notRendered) return result('not-rendered', 'ancestor-not-rendered')

  if (style.visibility === 'hidden' || style.visibility === 'collapse') return result('hidden', 'visibility-hidden')

  const transparent = native ? !el.checkVisibility({ opacityProperty: true }) : style.opacity === '0' || ancestors!.transparent
  if (transparent) return result('hidden', 'opacity-zero')

  // display:contents boxes have no geometry of their own.
  if (style.display === 'contents') return result('visible', 'not-measurable')

  const rect = el.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return result('hidden', 'zero-size')
  // 1×1 px boxes are the standard "visually hidden / screen-reader only" pattern.
  if (rect.width <= 1 && rect.height <= 1) return result('hidden', 'visually-hidden')

  const inViewport = rect.bottom > 0 && rect.right > 0 && rect.top < ctx.viewportHeight && rect.left < ctx.viewportWidth
  // Off-screen is not hidden: the user can scroll to it.
  if (!inViewport) return result('visible', 'outside-viewport')

  if (isCovered(el, rect, style, ctx)) return result('obscured', 'covered-by-other-element', true)
  return result('visible', 'rendered', true)
}

/** Hit-tests the element's centre point. Only a hint: partial overlap is not detected. */
function isCovered(el: Element, rect: DOMRect, style: CSSStyleDeclaration, ctx: LayoutContext): boolean {
  if (style.pointerEvents === 'none') return false // hit testing passes through; can't tell
  const x = rect.left + rect.width / 2
  const y = rect.top + rect.height / 2
  if (x < 0 || y < 0 || x >= ctx.viewportWidth || y >= ctx.viewportHeight) return false
  const root = el.getRootNode() as Document | ShadowRoot
  if (typeof root.elementFromPoint !== 'function') return false
  const hit = root.elementFromPoint(x, y)
  if (!hit || hit === el || el.contains(hit) || hit.contains(el)) return false
  // A label activates its control, so a label over its own input is not obstruction.
  if (hit.localName === 'label' && (hit as HTMLLabelElement).control === el) return false
  return true
}

/** Elements with a native disabled state. */
const DISABLEABLE = new Set(['button', 'input', 'select', 'textarea', 'option', 'optgroup', 'fieldset'])

function matchesDisabled(el: Element): boolean {
  try {
    return el.matches(':disabled') // includes <fieldset disabled> inheritance and disabled optgroups
  } catch {
    return el.hasAttribute('disabled')
  }
}

export function getEnabledState(el: Element, categories: ElementCategory[]): EnabledStatus {
  const native = DISABLEABLE.has(el.localName)
  const applicable = native || categories.includes('interactive') || el.hasAttribute('aria-disabled')
  if (!applicable) return 'not-applicable'
  if (native && matchesDisabled(el)) return 'disabled'
  // aria-disabled applies to the element and its descendants; inert removes interactivity.
  if (el.closest('[aria-disabled="true"], [inert]')) return 'disabled'
  if (isReadOnly(el)) return 'readonly'
  return 'enabled'
}
