// Decides whether an element is worth extracting and which categories it belongs to.
// Pure DOM reads, no layout. One call per element.
import type { ElementCategory, InteractiveHint } from '../../shared/types'
import { TEST_ID_ATTRIBUTES } from '../../shared/constants'
import { editingHost, ownText } from './text'

const INTERACTIVE_ROLES = [
  'button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'menuitemcheckbox',
  'menuitemradio', 'option', 'combobox', 'slider', 'spinbutton', 'textbox', 'searchbox',
  'listbox', 'treeitem', 'scrollbar',
]

const ROLE_CATEGORY: Record<string, ElementCategory> = {
  ...Object.fromEntries(INTERACTIVE_ROLES.map((r) => [r, 'interactive' as const])),
  navigation: 'navigation', menubar: 'navigation', menu: 'navigation', tablist: 'navigation', tree: 'navigation',
  form: 'form', radiogroup: 'form',
  heading: 'text', paragraph: 'text', note: 'text', status: 'text', alert: 'text', tooltip: 'text', log: 'text',
  img: 'media',
  table: 'table', grid: 'table', treegrid: 'table', row: 'table', rowgroup: 'table', cell: 'table',
  gridcell: 'table', columnheader: 'table', rowheader: 'table',
  list: 'list', listitem: 'list', feed: 'list',
  main: 'structural', banner: 'structural', contentinfo: 'structural', region: 'structural',
  complementary: 'structural', dialog: 'structural', alertdialog: 'structural', search: 'structural',
  toolbar: 'structural', tabpanel: 'structural', article: 'structural', group: 'structural',
}

const TAG_CATEGORY: Record<string, ElementCategory> = {
  a: 'interactive', button: 'interactive', summary: 'interactive', details: 'interactive',
  input: 'form', textarea: 'form', select: 'form', option: 'form', optgroup: 'form', datalist: 'form',
  output: 'form', label: 'form', fieldset: 'form', legend: 'form', form: 'form',
  nav: 'navigation',
  h1: 'text', h2: 'text', h3: 'text', h4: 'text', h5: 'text', h6: 'text', p: 'text',
  blockquote: 'text', pre: 'text', figcaption: 'text',
  img: 'media', svg: 'media', video: 'media', audio: 'media', canvas: 'media', iframe: 'media',
  object: 'media', embed: 'media',
  table: 'table', thead: 'table', tbody: 'table', tfoot: 'table', tr: 'table', th: 'table', td: 'table',
  caption: 'table',
  ul: 'list', ol: 'list', li: 'list', dl: 'list', dt: 'list', dd: 'list', menu: 'list',
  main: 'structural', header: 'structural', footer: 'structural', aside: 'structural',
  section: 'structural', article: 'structural', dialog: 'structural', figure: 'structural', search: 'structural',
}

/** Form controls that are also interactive. */
const FORM_CONTROLS = new Set(['input', 'textarea', 'select', 'option'])

/** Natively focusable tags: a tabindex on these is not an "extra" hint. */
const NATIVELY_FOCUSABLE = new Set(['a', 'button', 'input', 'select', 'textarea', 'summary', 'iframe', 'area'])


/**
 * Ancestors whose own record already carries the text of their descendants.
 * A text leaf inside one of these is not extracted separately.
 */
const TEXT_OWNER_SELECTOR = [
  'a', 'button', 'label', 'summary', 'legend', 'option', 'caption', 'figcaption',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'dt', 'dd', 'td', 'th', 'pre', 'blockquote',
  ...INTERACTIVE_ROLES.map((r) => `[role="${r}"]`), '[role="heading"]',
].join(',')

/** Tags whose content is never text worth a record of its own. */
const NO_TEXT_LEAF = new Set(['br', 'hr', 'wbr', 'col', 'colgroup', 'source', 'track', 'param', 'slot'])

export interface Classification {
  category: ElementCategory
  categories: ElementCategory[]
  hints: InteractiveHint[]
  role?: string
  roleSource?: 'explicit' | 'implicit'
}

export function explicitRole(el: Element): string | undefined {
  return el.getAttribute('role')?.trim().split(/\s+/)[0]?.toLowerCase() || undefined
}

export function hasTestId(el: Element): boolean {
  return TEST_ID_ATTRIBUTES.some((a) => el.hasAttribute(a))
}

/** Returns null when the element is not relevant enough to extract. */
export function classify(el: Element): Classification | null {
  const tag = el.localName
  if (tag === 'input' && (el as HTMLInputElement).type === 'hidden') return null

  const role = explicitRole(el)
  const presentational = role === 'none' || role === 'presentation'
  const categories: ElementCategory[] = []
  const add = (c: ElementCategory | undefined) => {
    if (c && !categories.includes(c)) categories.push(c)
  }

  // An explicit role wins over tag semantics, then the tag adds its own category.
  if (role && !presentational) add(ROLE_CATEGORY[role])
  if (!presentational || FORM_CONTROLS.has(tag) || tag === 'button' || tag === 'a') add(TAG_CATEGORY[tag])

  // Secondary categories.
  if (FORM_CONTROLS.has(tag)) add('interactive')
  if (tag === 'button' && (el as HTMLButtonElement).form) add('form')
  if ((tag === 'a' || role === 'link') && el.closest('nav, [role="navigation"]')) add('navigation')

  const hints: InteractiveHint[] = []
  const tabindex = el.getAttribute('tabindex')
  if (tabindex !== null && Number(tabindex) >= 0 && !NATIVELY_FOCUSABLE.has(tag)) hints.push('tabindex')
  const host = editingHost(el)
  if (host === el) hints.push('contenteditable')
  if (el.hasAttribute('onclick')) hints.push('onclick-attribute')
  if (hasTestId(el)) hints.push('test-id')

  // Non-semantic but keyboard-focusable / editable / click-handled: interactive.
  // The role is left as authored: an onclick attribute does not make a "button".
  if (hints.includes('tabindex') || hints.includes('contenteditable') || hints.includes('onclick-attribute')) {
    add('interactive')
  }

  const isCustom = tag.includes('-')
  // Custom elements without semantics are grouped as custom, never assumed interactive.
  if (categories.length === 0 && isCustom) add('custom')

  if (categories.length === 0) {
    // Generic elements that carry a test id or an author-provided label.
    if (hints.includes('test-id') || el.hasAttribute('aria-label') || el.hasAttribute('title')) {
      add(el.childElementCount === 0 ? 'text' : 'structural')
    } else if (isTextLeaf(el, tag, host)) {
      add('text')
    }
  }

  if (isCustom) add('custom')

  const category = categories[0]
  if (!category) return null

  const implicit = role ? undefined : implicitRole(el)
  return {
    category,
    categories,
    hints,
    role: role ?? implicit,
    roleSource: role ? 'explicit' : implicit ? 'implicit' : undefined,
  }
}

/** A childless element with its own meaningful text that no extracted ancestor already covers. */
function isTextLeaf(el: Element, tag: string, host: Element | null): boolean {
  if (el.childElementCount > 0 || NO_TEXT_LEAF.has(tag) || host) return false
  if (el.namespaceURI !== 'http://www.w3.org/1999/xhtml') return false
  if (ownText(el).length < 2) return false
  return !el.parentElement?.closest(TEXT_OWNER_SELECTOR)
}

const INPUT_ROLES: Record<string, string> = {
  button: 'button', submit: 'button', reset: 'button', image: 'button', checkbox: 'checkbox', radio: 'radio',
  range: 'slider', number: 'spinbutton', search: 'searchbox', email: 'textbox', tel: 'textbox',
  text: 'textbox', url: 'textbox',
}

const SIMPLE_IMPLICIT_ROLES: Record<string, string> = {
  button: 'button', textarea: 'textbox', option: 'option', nav: 'navigation', main: 'main',
  aside: 'complementary', article: 'article', dialog: 'dialog', table: 'table', tr: 'row', td: 'cell',
  thead: 'rowgroup', tbody: 'rowgroup', tfoot: 'rowgroup', ul: 'list', ol: 'list',
  menu: 'list', li: 'listitem', details: 'group', fieldset: 'group', p: 'paragraph',
  h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading',
  progress: 'progressbar', meter: 'meter', output: 'status', search: 'search', figure: 'figure',
  hr: 'separator', dl: 'list',
}

/** The ARIA role a tag has without an explicit `role` (HTML-AAM, common cases only). */
export function implicitRole(el: Element): string | undefined {
  const tag = el.localName
  switch (tag) {
    case 'a':
    case 'area':
      return el.hasAttribute('href') ? 'link' : undefined
    case 'input': {
      const input = el as HTMLInputElement
      if (el.hasAttribute('list') && ['text', 'search', 'email', 'tel', 'url'].includes(input.type)) return 'combobox'
      return INPUT_ROLES[input.type]
    }
    case 'select': {
      const select = el as HTMLSelectElement
      return select.multiple || select.size > 1 ? 'listbox' : 'combobox'
    }
    case 'img':
      return el.getAttribute('alt') === '' ? 'presentation' : 'img'
    case 'header':
    case 'footer':
      // Only page-level header/footer are landmarks.
      if (el.parentElement?.closest('article, aside, main, nav, section')) return undefined
      return tag === 'header' ? 'banner' : 'contentinfo'
    case 'section':
      return el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby') ? 'region' : undefined
    case 'form':
      // Like <section>, a form is only a landmark when it has an explicit name.
      return el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby') ? 'form' : undefined
    case 'th':
      return el.getAttribute('scope')?.toLowerCase() === 'row' ? 'rowheader' : 'columnheader'
    default:
      return SIMPLE_IMPLICIT_ROLES[tag]
  }
}
