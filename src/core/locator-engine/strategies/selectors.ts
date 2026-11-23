// CSS and XPath selectors built from the element's own attributes. Structural
// (ancestor-anchored) selectors are only produced as a last-resort fallback.
import { SCAN_LIMITS, TEST_ID_ATTRIBUTES } from '../../../shared/constants'
import type { ScannedElement, StabilityLevel } from '../../../shared/types'
import type { Candidate, Strategy, StrategyContext } from '../types'
import { cssIdent, cssString, pageCall, xpathString } from '../utils/escaping'
import { assessText, assessValue, generatedReason, type Assessment } from '../utils/stability'
import { attrValue, isTruncated, matchText } from './semantic'

const NAME_TAGS = new Set(['input', 'select', 'textarea', 'button', 'form', 'iframe', 'object', 'fieldset', 'output', 'map'])

/** Classes that describe state rather than identity. */
const STATE_CLASS =
  /^(is|has)-|^ng-|^(active|selected|open|opened|closed|current|disabled|enabled|focus|focused|hover|hovered|checked|expanded|collapsed|show|shown|hidden|visible|invisible|in|fade|loading|loaded|error|valid|invalid|dirty|pristine|touched|untouched)$/i
/** Utility / layout classes (Tailwind, Bootstrap): presentational and widely shared. */
const UTILITY_CLASS =
  /[:[\]/!@]|^-?[mp][trblxyse]?-\S|^(w|h|min-w|max-w|min-h|max-h|size|gap|space-[xy]|text|bg|border|rounded|shadow|flex|grid|col|row|items|justify|content|self|place|font|leading|tracking|z|top|left|right|bottom|inset|opacity|overflow|block|inline|absolute|relative|fixed|sticky|static|cursor|transition|duration|ease|delay|animate|d|align|float|order|basis|grow|shrink|ring|outline|fill|stroke|object|aspect|sr-only|underline|uppercase|lowercase|capitalize|truncate|italic|whitespace|break|select|pointer-events|container|clearfix|pull|offset|g|gx|gy|fs|fw|lh)(-|$)/
/** Names too generic to identify anything. */
const GENERIC_CLASS =
  /^(wrapper|wrap|inner|outer|content|main|item|items|box|section|component|root|app|layout|group|holder|element|el|widget|module|panel|clearfix|cf)$/i

/** Up to two classes that look hand-written, semantic and stable. */
export function meaningfulClasses(el: ScannedElement): string[] {
  const raw = el.attributes.class
  if (!raw) return []
  let tokens = raw.split(/\s+/).filter(Boolean)
  if (isTruncated(raw, SCAN_LIMITS.maxAttributeLength)) tokens = tokens.slice(0, -1) // last token may be cut
  return [...new Set(tokens)]
    .filter((c) => c.length >= 2 && !generatedReason(c) && !UTILITY_CLASS.test(c) && !STATE_CLASS.test(c) && !GENERIC_CLASS.test(c))
    .slice(0, 2)
}

/** One "semantic attribute" selector per element, chosen in this order. */
const SEMANTIC_ATTRIBUTES: { attr: string; tags?: string[]; level: StabilityLevel; reason: string; enumerated?: boolean }[] = [
  { attr: 'href', tags: ['a', 'area'], level: 'moderate', reason: 'Link target: changes when routes or environments change' },
  { attr: 'for', tags: ['label'], level: 'stable', reason: 'Label target id' },
  { attr: 'action', tags: ['form'], level: 'moderate', reason: 'Form endpoint: changes with routing' },
  { attr: 'aria-label', level: 'stable', reason: 'Accessible label attribute' },
  { attr: 'type', tags: ['input', 'button'], level: 'moderate', reason: 'Describes the kind of element rather than this specific element', enumerated: true },
  { attr: 'role', level: 'moderate', reason: 'Describes the kind of element rather than this specific element', enumerated: true },
]

function selectorCandidate(
  key: string,
  rank: number,
  selector: string,
  a: Assessment,
  sourceAttributes: string[],
  strategy: 'css' | 'xpath' = 'css',
): Candidate {
  return {
    key, strategy, rank,
    expression: pageCall('locator', selector),
    displayValue: selector,
    stability: a.level, stabilityReasons: a.reasons, sourceAttributes, notes: [],
  }
}

export const cssStrategy: Strategy = (el) => {
  const out: Candidate[] = []
  const tag = cssIdent(el.tagName)

  const id = attrValue(el, 'id')
  if (id) out.push(selectorCandidate('css-id', 70, `#${cssIdent(id)}`, assessValue('stable', 'id attribute', id), ['id']))

  const name = attrValue(el, 'name')
  if (name && NAME_TAGS.has(el.tagName)) {
    out.push(selectorCandidate('css-name', 71, `${tag}[name=${cssString(name)}]`,
      assessValue('stable', 'Form field name, usually tied to the submitted data', name), ['name']))
  }

  for (const s of SEMANTIC_ATTRIBUTES) {
    if (s.tags && !s.tags.includes(el.tagName)) continue
    const value = attrValue(el, s.attr)
    if (!value || (s.attr === 'href' && /^javascript:/i.test(value))) continue
    const a = s.enumerated ? { level: s.level, reasons: [s.reason] } : assessValue(s.level, s.reason, value)
    out.push(selectorCandidate('css-attr', 72, `${tag}[${s.attr}=${cssString(value)}]`, a, [s.attr]))
    break
  }

  const classes = meaningfulClasses(el)
  if (classes.length) {
    out.push(selectorCandidate('css-class', 90, `${tag}${classes.map((c) => `.${cssIdent(c)}`).join('')}`,
      { level: 'moderate', reasons: ['Class names change with styling refactors'] }, ['class']))
  }
  return out
}

/** True for <svg> and anything inside one (XPath needs local-name() there). */
function inSvg(el: ScannedElement, ctx: StrategyContext): boolean {
  for (let e: ScannedElement | undefined = el; e; e = e.parentId ? ctx.byId.get(e.parentId) : undefined) {
    if (e.tagName === 'svg') return true
  }
  return false
}

function xpathNodeTest(el: ScannedElement, ctx: StrategyContext): string {
  return /^[a-z][a-z0-9-]*$/.test(el.tagName) && !inSvg(el, ctx) ? el.tagName : `*[local-name()=${xpathString(el.tagName)}]`
}

const XPATH_ATTRIBUTES: { attr: string; level: StabilityLevel; reason: string; enumerated?: boolean }[] = [
  { attr: 'id', level: 'stable', reason: 'id attribute' },
  ...TEST_ID_ATTRIBUTES.map((attr) => ({ attr, level: 'stable' as const, reason: `Explicit test hook (${attr})` })),
  { attr: 'name', level: 'stable', reason: 'name attribute' },
  { attr: 'aria-label', level: 'stable', reason: 'Accessible label attribute' },
  { attr: 'placeholder', level: 'moderate', reason: 'Placeholder hint text' },
  { attr: 'title', level: 'stable', reason: 'title attribute' },
  { attr: 'alt', level: 'stable', reason: 'Alternative text' },
  { attr: 'href', level: 'moderate', reason: 'Link target' },
  { attr: 'type', level: 'moderate', reason: 'Describes the kind of element rather than this specific element', enumerated: true },
]

/** One attribute-based XPath (or exact-text XPath). XPath cannot reach into shadow roots. */
export const xpathStrategy: Strategy = (el, ctx) => {
  if (el.inShadowRoot) return []
  const node = xpathNodeTest(el, ctx)
  for (const x of XPATH_ATTRIBUTES) {
    const value = attrValue(el, x.attr)
    if (!value) continue
    const a = x.enumerated ? { level: x.level, reasons: [x.reason] } : assessValue(x.level, x.reason, value)
    return [selectorCandidate('xpath', 100, `//${node}[@${x.attr}=${xpathString(value)}]`, a, [x.attr], 'xpath')]
  }
  const text = matchText(el.textContent, SCAN_LIMITS.maxTextLength)
  if (text && /[\p{L}\p{N}]/u.test(text)) {
    const a = assessText('moderate', 'Exact visible text', text)
    return [selectorCandidate('xpath', 100, `//${node}[normalize-space(.)=${xpathString(text)}]`, a, ['text content'], 'xpath')]
  }
  return []
}

/** Nearest extracted ancestor with a hand-written id or test id, as CSS and XPath anchors. */
function findAnchor(el: ScannedElement, ctx: StrategyContext): { css: string; xpath: string; source: string } | undefined {
  let ancestor = el.parentId ? ctx.byId.get(el.parentId) : undefined
  for (let hops = 0; ancestor && hops < 6; hops++) {
    for (const attr of ['id', ...TEST_ID_ATTRIBUTES]) {
      const value = attrValue(ancestor, attr)
      if (value && !generatedReason(value)) {
        return {
          css: attr === 'id' ? `#${cssIdent(value)}` : `[${attr}=${cssString(value)}]`,
          xpath: `//*[@${attr}=${xpathString(value)}]`,
          source: `ancestor <${ancestor.tagName}> ${attr}`,
        }
      }
    }
    ancestor = ancestor.parentId ? ctx.byId.get(ancestor.parentId) : undefined
  }
  return undefined
}

/**
 * Last resort for elements with no usable attribute, name or text: an ancestor
 * anchor plus the tag. Deliberately unstable and never recommended.
 */
export const structuralFallback: Strategy = (el, ctx) => {
  const anchor = findAnchor(el, ctx)
  if (!anchor) return []
  const a: Assessment = { level: 'unstable', reasons: ['Depends on page structure: an ancestor anchor plus the tag name'] }
  const out = [selectorCandidate('css-structural', 110, `${anchor.css} ${cssIdent(el.tagName)}`, a, [anchor.source, 'tag'])]
  if (!el.inShadowRoot) {
    out.push(selectorCandidate('xpath-structural', 111, `${anchor.xpath}//${xpathNodeTest(el, ctx)}`, a, [anchor.source, 'tag'], 'xpath'))
  }
  return out
}
