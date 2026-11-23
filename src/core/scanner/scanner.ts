// DOM Scanner v1: one pass over the document (and open shadow roots), producing
// serializable records. It reads the DOM only: no clicks, no scrolling, no
// mutations, no form values, and no selectors or locators.
import { CATEGORIES, SCAN_LIMITS } from '../../shared/constants'
import type { ElementCategory, ScannedElement, ScanResult, ScanSummary, VisibilityStatus } from '../../shared/types'
import { collectAttributes, collectProperties } from './attributes'
import { classify } from './classify'
import { createLayoutContext, flatParent, getEnabledState, getVisibility } from './state'
import { accessibleName, editingHost, subtreeText } from './text'

export interface ScanOptions {
  /** Stop after this many extracted elements (default SCAN_LIMITS.maxElements). */
  maxElements?: number
}

export interface ScanOutput {
  result: ScanResult
  /** Scan id → live element. Stays in the content script; never serialized. */
  elements: Map<string, Element>
}

/** Subtrees that never contain page UI. */
const SKIP_SUBTREE = new Set(['head', 'script', 'style', 'noscript', 'template', 'link', 'meta', 'title', 'base'])

/** Containers whose text would just repeat their children's text. */
const NO_TEXT_PREVIEW = new Set([
  'main', 'header', 'footer', 'nav', 'aside', 'section', 'article', 'form', 'fieldset', 'details', 'dialog',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'ul', 'ol', 'dl', 'menu', 'figure', 'search',
  'input', 'textarea', 'select', 'svg', 'video', 'audio', 'iframe', 'object', 'canvas',
])

const SVG_NS = 'http://www.w3.org/2000/svg'

function acceptNode(node: Node): number {
  const el = node as Element
  if (SKIP_SUBTREE.has(el.localName)) return NodeFilter.FILTER_REJECT
  // Inside <svg>, only links are interesting; shapes and groups are skipped (their children still walked).
  if (el.namespaceURI === SVG_NS && el.localName !== 'svg' && el.localName !== 'a') return NodeFilter.FILTER_SKIP
  return NodeFilter.FILTER_ACCEPT
}

function createScanId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function emptyCounts<K extends string>(keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>
}

const VISIBILITY_STATUSES: VisibilityStatus[] = ['visible', 'hidden', 'not-rendered', 'obscured', 'unknown']

export function scanDocument(doc: Document, options: ScanOptions = {}): ScanOutput {
  const started = performance.now()
  const view = doc.defaultView
  if (!view) throw new Error('The document has no window to measure against.')

  const limit = options.maxElements ?? SCAN_LIMITS.maxElements
  const layout = createLayoutContext(view)
  const records: ScannedElement[] = []
  const elements = new Map<string, Element>()
  const recordOf = new Map<Element, ScannedElement>()
  let shadowRoots = 0
  let frames = 0
  let skipped = 0
  let truncated = false
  let sequence = 0

  const inspect = (el: Element, inShadowRoot: boolean) => {
    if (recordOf.has(el)) return // defensive: an element is recorded at most once
    const tag = el.localName
    if (tag === 'iframe' || tag === 'frame') frames++

    const cls = classify(el)
    if (!cls) return

    const editable = editingHost(el) !== null
    const isEditingHost = cls.hints.includes('contenteditable')
    let parent: ScannedElement | undefined
    for (let a = flatParent(el); a && !parent; a = flatParent(a)) parent = recordOf.get(a)
    const visibility = getVisibility(el, layout)
    const name = accessibleName(el, cls.role)

    const record: ScannedElement = {
      id: `el-${(++sequence).toString(36)}`,
      tagName: tag,
      category: cls.category,
      categories: cls.categories,
      hints: cls.hints,
      attributes: collectAttributes(el),
      textContent:
        editable || NO_TEXT_PREVIEW.has(tag) ? undefined : subtreeText(el, SCAN_LIMITS.maxTextLength) || undefined,
      accessibleName: name?.name,
      accessibleNameSource: name?.source,
      role: cls.role,
      roleSource: cls.roleSource,
      visibility: visibility.status,
      visibilityReason: visibility.reason,
      inViewport: visibility.inViewport,
      enabledState: getEnabledState(el, cls.categories),
      parentTagName: flatParent(el)?.localName,
      parentId: parent?.id,
      childElementCount: el.childElementCount,
      depth: parent ? parent.depth + 1 : 0,
      inShadowRoot,
      isCustomElement: tag.includes('-'),
      properties: collectProperties(el, isEditingHost),
    }
    records.push(record)
    recordOf.set(el, record)
    elements.set(record.id, el)
  }

  /** Walks one tree (document or shadow root). Returns false once the limit is hit. */
  const walk = (root: Document | ShadowRoot, inShadowRoot: boolean): boolean => {
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, { acceptNode })
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (records.length >= limit) {
        truncated = true
        return false
      }
      const el = node as Element
      try {
        inspect(el, inShadowRoot)
      } catch {
        skipped++ // one unusual element must not abort the scan
      }
      // Open shadow roots only; closed roots are invisible to page and content scripts.
      const shadow = el.shadowRoot
      if (shadow) {
        shadowRoots++
        if (!walk(shadow, true)) return false
      }
    }
    return true
  }

  walk(doc, false)

  const byCategory = emptyCounts<ElementCategory>(CATEGORIES.map((c) => c.id))
  const byVisibility = emptyCounts(VISIBILITY_STATUSES)
  let disabled = 0
  for (const r of records) {
    byCategory[r.category]++
    byVisibility[r.visibility]++
    if (r.enabledState === 'disabled') disabled++
  }

  const summary: ScanSummary = {
    totalElements: records.length,
    byCategory,
    byVisibility,
    disabledElements: disabled,
    shadowRootsScanned: shadowRoots,
    framesNotScanned: frames,
    skippedElements: skipped,
    truncated,
    elementLimit: limit,
    durationMs: Math.round(performance.now() - started),
  }

  return {
    result: {
      scanId: createScanId(),
      url: doc.URL,
      title: doc.title,
      timestamp: Date.now(),
      summary,
      elements: records,
    },
    elements,
  }
}
