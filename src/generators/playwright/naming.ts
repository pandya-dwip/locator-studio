// Identifier naming for generated Page Objects: property, parameter and class names.
import { elementKind } from '../../shared/element-kind'
import { TEST_ID_ATTRIBUTES } from '../../shared/constants'
import type { ScannedElement } from '../../shared/types'

const RESERVED = new Set([
  'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else',
  'enum', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'implements', 'import', 'in',
  'instanceof', 'interface', 'let', 'new', 'null', 'package', 'private', 'protected', 'public', 'return', 'static',
  'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'async',
  'arguments', 'eval', 'undefined', 'NaN', 'Infinity', 'constructor', 'prototype', '__proto__',
])

const IDENTIFIER = /^[\p{ID_Start}$_][\p{ID_Continue}$]*$/u

export function isValidIdentifier(name: string): boolean {
  return IDENTIFIER.test(name) && !RESERVED.has(name)
}

/** Words of a label, accents folded to ASCII where possible ("Café" → "Cafe"). */
export function words(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2') // split camelCase: "loginButton" → "login Button"
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()

export function camelCase(ws: string[]): string {
  return ws.map((w, i) => (i === 0 ? w.toLowerCase() : cap(w))).join('')
}

export function pascalCase(ws: string[]): string {
  return ws.map(cap).join('')
}

/** Suffix describing what the element is, and words that already say so. */
function suffixFor(el: ScannedElement): { suffix: string; synonyms: string[] } {
  const kind = elementKind(el)
  const role = el.role
  if (kind === 'field') {
    if (role === 'checkbox') return { suffix: 'Checkbox', synonyms: ['checkbox', 'check'] }
    if (role === 'radio') return { suffix: 'Radio', synonyms: ['radio'] }
    if (role === 'switch') return { suffix: 'Switch', synonyms: ['switch', 'toggle'] }
    if (role === 'slider') return { suffix: 'Slider', synonyms: ['slider', 'range'] }
    if (el.tagName === 'select' || role === 'combobox' || role === 'listbox') return { suffix: 'Select', synonyms: ['select', 'dropdown', 'picker'] }
    return { suffix: 'Input', synonyms: ['input', 'field', 'box', 'textbox', 'textarea'] }
  }
  if (kind === 'button') return { suffix: 'Button', synonyms: ['button', 'btn'] }
  if (kind === 'link') return { suffix: 'Link', synonyms: ['link'] }
  if (kind === 'media') return { suffix: 'Image', synonyms: ['image', 'img', 'logo', 'icon', 'picture', 'photo', 'avatar', 'video', 'banner'] }
  if (role === 'heading') return { suffix: 'Heading', synonyms: ['heading', 'title'] }
  if (kind === 'text') return { suffix: 'Text', synonyms: ['text', 'message', 'label'] }
  const tag = el.role ?? el.tagName
  const tagWords = words(tag)
  return { suffix: pascalCase(tagWords) || 'Element', synonyms: tagWords.map((w) => w.toLowerCase()) }
}

/** Human-meaningful words for an element, best source first. */
function sourceWords(el: ScannedElement): string[] {
  const a = el.attributes
  const testAttr = TEST_ID_ATTRIBUTES.find((t) => a[t])
  const sources = [el.accessibleName, a.placeholder, a.id, a.name, testAttr ? a[testAttr] : undefined, el.textContent]
  for (const source of sources) {
    const ws = source ? words(source) : []
    // Skip values that are mostly numbers or machine-looking (e.g. "el-1234", "a8f3k2").
    if (ws.length && ws.some((w) => /\p{L}{2,}/u.test(w))) return ws.slice(0, 4)
  }
  return []
}

/** Base property name for an element: "Email address" input → "emailAddressInput". */
export function basePropertyName(el: ScannedElement): string {
  const { suffix, synonyms } = suffixFor(el)
  let ws = sourceWords(el)
  const last = ws[ws.length - 1]?.toLowerCase()
  if (!last || !synonyms.includes(last)) ws = [...ws, suffix]
  let name = camelCase(ws)
  if (/^\p{N}/u.test(name)) name = camelCase([suffix, ...ws.slice(0, -1)]) // "2fa" → "input2fa"
  return toIdentifier(name, camelCase([suffix]))
}

/** A valid, non-reserved identifier, or `fallback`. */
export function toIdentifier(name: string, fallback: string): string {
  if (isValidIdentifier(name)) return name
  if (IDENTIFIER.test(name) && RESERVED.has(name)) return `${name}Element`
  const cleaned = camelCase(words(name))
  if (isValidIdentifier(cleaned)) return cleaned
  return fallback
}

/**
 * Hands out unique names in call order: duplicates get deterministic numeric
 * suffixes (loginButton, loginButton2, ...).
 */
export function createNameRegistry(taken: string[] = []) {
  const used = new Set(taken)
  return (name: string): string => {
    let candidate = name
    for (let n = 2; used.has(candidate); n++) candidate = `${name}${n}`
    used.add(candidate)
    return candidate
  }
}

const TITLE_SEPARATOR = /\s[|\-–—:·•»]\s|\s[|–—·•»]|[|–—·•»]\s/

/** Default class name from the page title, falling back to the URL path. */
export function defaultClassName(title: string, url: string): string {
  const fromTitle = words(title.split(TITLE_SEPARATOR)[0] ?? '').slice(0, 4)
  let ws = fromTitle
  if (!ws.length) {
    try {
      const segment = new URL(url).pathname.split('/').filter(Boolean).pop() ?? ''
      ws = words(segment.replace(/\.[a-z0-9]+$/i, '')).slice(0, 4)
    } catch {
      ws = []
    }
  }
  return sanitizeClassName(pascalCase(ws))
}

/** Turns any user input into a valid PascalCase class name ending in "Page". */
export function sanitizeClassName(input: string): string {
  let name = pascalCase(words(input))
  if (!name) name = 'Generated'
  if (/^\p{N}/u.test(name)) name = `Page${name}`
  if (!/Page$/.test(name)) name = `${name}Page`
  return isValidIdentifier(name) ? name : 'GeneratedPage'
}
