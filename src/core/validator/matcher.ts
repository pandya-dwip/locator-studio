// Browser-side equivalents of Playwright locators, evaluated against the live
// DOM from data-only LocatorQuery objects. Nothing here executes strings as code.
//
// Exact (same semantics as Playwright): css, xpath, testid, placeholder,
// alttext, title. Approximate: role (implicit-role table and accessible-name
// approximation from the scanner), label and text (simplified text rules).
import type { LocatorQuery } from '../../shared/types'
import { cssString } from '../locator-engine/utils/escaping'
import { explicitRole, implicitRole } from '../scanner/classify'
import { flatParent } from '../scanner/state'
import { accessibleName, normalize } from '../scanner/text'

export class InvalidSelectorError extends Error {}

export interface Matcher {
  /** All elements the query matches. Throws InvalidSelectorError for bad CSS/XPath. */
  match(query: LocatorQuery): Element[]
}

/** Kinds whose matching approximates (rather than reproduces) Playwright's algorithm. */
export const APPROXIMATE_KINDS = new Set<LocatorQuery['kind']>(['role', 'label', 'text'])

const NO_TEXT = new Set(['script', 'style', 'noscript', 'template', 'head', 'title'])

/** Playwright's default text matching: whitespace-normalised, case-insensitive substring. */
function textMatches(haystack: string, needle: string, exact = false): boolean {
  const h = normalize(haystack)
  const n = normalize(needle)
  return exact ? h === n : h.toLowerCase().includes(n.toLowerCase())
}

/**
 * Creates a matcher for one validation request. DOM-derived indexes (shadow
 * roots, roles, names, texts) are built lazily and reused within the request.
 */
export function createMatcher(doc: Document): Matcher {
  const view = doc.defaultView
  let roots: (Document | ShadowRoot)[] | undefined
  let byRole: Map<string, Element[]> | undefined
  let labelled: Element[] | undefined
  const names = new Map<Element, string>()
  const texts = new Map<Element, string>()
  const styles = new Map<Element, CSSStyleDeclaration>()

  /** The document plus every open shadow root (Playwright's CSS and text engines pierce them). */
  const getRoots = () => {
    if (!roots) {
      roots = [doc]
      for (let i = 0; i < roots.length; i++) {
        for (const el of roots[i]!.querySelectorAll('*')) if (el.shadowRoot) roots.push(el.shadowRoot)
      }
    }
    return roots
  }

  const css = (selector: string): Element[] => {
    try {
      return getRoots().flatMap((r) => [...r.querySelectorAll(selector)])
    } catch (err) {
      throw new InvalidSelectorError(err instanceof Error ? err.message : String(err))
    }
  }

  const xpath = (selector: string): Element[] => {
    let snapshot: XPathResult
    try {
      snapshot = doc.evaluate(selector, doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null)
    } catch (err) {
      throw new InvalidSelectorError(err instanceof Error ? err.message : String(err))
    }
    const out: Element[] = []
    for (let i = 0; i < snapshot.snapshotLength; i++) {
      const node = snapshot.snapshotItem(i)
      if (node instanceof Element) out.push(node)
    }
    return out
  }

  const style = (el: Element) => {
    let s = styles.get(el)
    if (!s && view) styles.set(el, (s = view.getComputedStyle(el)))
    return s
  }

  /** getByRole() skips elements excluded from the accessibility tree. */
  const hiddenForAria = (target: Element): boolean => {
    const el = target.localName === 'option' || target.localName === 'optgroup' ? (target.closest('select') ?? target) : target
    if (el.closest('[aria-hidden="true"]')) return true
    if (typeof el.checkVisibility === 'function' && style(el)?.display !== 'contents') {
      return !el.checkVisibility({ visibilityProperty: true })
    }
    for (let a: Element | null = el; a; a = flatParent(a)) if (style(a)?.display === 'none') return true
    const visibility = style(el)?.visibility
    return visibility === 'hidden' || visibility === 'collapse'
  }

  const roleIndex = () => {
    if (!byRole) {
      byRole = new Map()
      for (const root of getRoots()) {
        for (const el of root.querySelectorAll('*')) {
          const role = explicitRole(el) ?? implicitRole(el)
          if (!role) continue
          const list = byRole.get(role)
          if (list) list.push(el)
          else byRole.set(role, [el])
        }
      }
    }
    return byRole
  }

  const nameOf = (el: Element, role: string) => {
    let name = names.get(el)
    if (name === undefined) names.set(el, (name = accessibleName(el, role)?.name ?? ''))
    return name
  }

  const headingLevel = (el: Element) => {
    const aria = Number(el.getAttribute('aria-level'))
    if (Number.isInteger(aria) && aria > 0) return aria
    const tag = /^h([1-6])$/.exec(el.localName)
    return tag ? Number(tag[1]) : undefined
  }

  /** aria-label, aria-labelledby text and associated <label>s. */
  const labelTexts = (el: Element): string[] => {
    const out: string[] = []
    const ariaLabel = el.getAttribute('aria-label')
    if (ariaLabel) out.push(ariaLabel)
    const labelledBy = el.getAttribute('aria-labelledby')
    if (labelledBy) {
      const root = el.getRootNode() as Document | ShadowRoot
      const text = labelledBy
        .split(/\s+/)
        .map((id) => root.getElementById?.(id)?.textContent ?? '')
        .join(' ')
      out.push(text)
    }
    const labels = (el as HTMLInputElement).labels
    if (labels) for (const l of labels) out.push(l.textContent ?? '')
    return out
  }

  /** Element text as getByText sees it: button-like inputs use their value. */
  const textOf = (el: Element) => {
    let text = texts.get(el)
    if (text === undefined) {
      const input = el as HTMLInputElement
      text =
        el.localName === 'input' && ['button', 'submit', 'reset'].includes(input.type)
          ? (el.getAttribute('value') ?? '')
          : `${el.textContent ?? ''} ${el.shadowRoot?.textContent ?? ''}`
      texts.set(el, (text = normalize(text)))
    }
    return text
  }

  const childrenOf = (el: Element): Element[] => [...el.children, ...(el.shadowRoot ? [...el.shadowRoot.children] : [])]

  /**
   * getByText returns the innermost elements containing the text. Walk down
   * from <body> following only subtrees that contain it.
   */
  const byText = (needle: string, exact = false): Element[] => {
    const start = doc.body ?? doc.documentElement
    if (!start) return []
    const contains = (el: Element) => !NO_TEXT.has(el.localName) && textMatches(textOf(el), needle)
    const out: Element[] = []
    const stack: Element[] = contains(start) ? [start] : []
    while (stack.length) {
      const el = stack.pop()!
      const inner = childrenOf(el).filter(contains)
      const selfMatches = exact ? textMatches(textOf(el), needle, true) : true
      if (inner.length === 0 && selfMatches) out.push(el)
      else if (exact && selfMatches && !inner.some((c) => textMatches(textOf(c), needle, true))) out.push(el)
      stack.push(...inner)
    }
    return out
  }

  const withAttribute = (attr: string, text: string, exact?: boolean) =>
    css(`[${attr}]`).filter((el) => textMatches(el.getAttribute(attr) ?? '', text, exact))

  return {
    match(q) {
      switch (q.kind) {
        case 'css':
          return css(q.selector)
        case 'xpath':
          return xpath(q.selector)
        case 'testid':
          return css(`[${q.attribute}=${cssString(q.value)}]`)
        case 'placeholder':
          return withAttribute('placeholder', q.text, q.exact)
        case 'alttext':
          return withAttribute('alt', q.text, q.exact)
        case 'title':
          return withAttribute('title', q.text, q.exact)
        case 'text':
          return byText(q.text, q.exact)
        case 'label':
          labelled ??= getRoots().flatMap((r) =>
            [...r.querySelectorAll('*')].filter(
              (el) => el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby') || ((el as HTMLInputElement).labels?.length ?? 0) > 0,
            ),
          )
          return labelled.filter((el) => labelTexts(el).some((t) => textMatches(t, q.text, q.exact)))
        case 'role':
          return (roleIndex().get(q.role) ?? []).filter(
            (el) =>
              !hiddenForAria(el) &&
              (q.level === undefined || headingLevel(el) === q.level) &&
              (q.name === undefined || textMatches(nameOf(el, q.role), q.name, q.exact)),
          )
        default:
          throw new Error(`Unsupported locator kind: ${(q as { kind: string }).kind}`)
      }
    },
  }
}
