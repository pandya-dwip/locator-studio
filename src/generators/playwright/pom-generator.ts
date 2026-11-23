// Playwright Page Object generator. Pure: structured scan, locator and
// validation data in, JavaScript or TypeScript source out. No DOM, no React.
import { elementKind } from '../../shared/element-kind'
import type {
  ElementLocatorResult,
  GeneratedLocator,
  OutputLanguage,
  ScannedElement,
  ScanResult,
} from '../../shared/types'
import { jsString } from '../../core/locator-engine/utils/escaping'
import { basePropertyName, camelCase, createNameRegistry, sanitizeClassName, toIdentifier, words } from './naming'
import { chooseLocator, type ValidationLookup } from './select'

export type ModuleFormat = 'commonjs' | 'esm'

export interface PomOptions {
  language: OutputLanguage
  /** JavaScript only. TypeScript always uses ES modules. */
  moduleFormat: ModuleFormat
  className: string
  includeMethods: boolean
  /** Use a candidate that was never validated when no validated one exists (marked in the code). */
  allowUnvalidated: boolean
  /** User-chosen property names by element id. */
  propertyNames?: Record<string, string>
}

export interface PomInput {
  scan: ScanResult
  /** Elements to include, in any order (output follows document order). */
  elementIds: string[]
  locators: Map<string, ElementLocatorResult>
  validationOf: ValidationLookup
  options: PomOptions
  /** For deterministic output in tests. */
  generatedAt?: Date
}

export interface PomProperty {
  elementId: string
  name: string
  locator: GeneratedLocator
  validated: boolean
  /** Emitted as comments above the property. */
  notes: string[]
}

export interface PomExclusion {
  elementId: string
  label: string
  reason: string
}

export interface PomResult {
  className: string
  fileName: string
  code: string
  properties: PomProperty[]
  excluded: PomExclusion[]
  methods: string[]
  /** Method signatures, with the element each parameter fills (used for test data). */
  methodDetails: PomMethodInfo[]
}

export interface PomMethodInfo {
  name: string
  params: { name: string; type: 'string' | 'boolean'; elementId?: string }[]
}

interface Method extends PomMethodInfo {
  body: string[]
}

/** Elements a Page Object usually exposes: buttons, links, form fields and headings. */
export function isPomEligible(el: ScannedElement): boolean {
  if (['option', 'optgroup', 'datalist'].includes(el.tagName)) return false
  const kind = elementKind(el)
  return kind === 'button' || kind === 'link' || kind === 'field' || el.role === 'heading'
}

export function elementLabel(el: ScannedElement): string {
  const text = el.accessibleName ?? el.textContent ?? (el.attributes.id ? `#${el.attributes.id}` : '')
  return `<${el.tagName}>${text ? ` ${text}` : ''}`
}

export function generatePom(input: PomInput): PomResult {
  const { scan, options } = input
  const className = sanitizeClassName(options.className)
  const wanted = new Set(input.elementIds)
  const byId = new Map(scan.elements.map((e) => [e.id, e]))
  // `page` and `goto` belong to the class itself.
  const nameFor = createNameRegistry(['page'])

  const properties: PomProperty[] = []
  const excluded: PomExclusion[] = []
  for (const el of scan.elements) {
    if (!wanted.has(el.id)) continue
    const choice = chooseLocator(input.locators.get(el.id), input.validationOf, options.allowUnvalidated)
    if (!choice.ok) {
      excluded.push({ elementId: el.id, label: elementLabel(el), reason: choice.reason })
      continue
    }
    const base = basePropertyName(el)
    const requested = options.propertyNames?.[el.id]?.trim()
    const name = nameFor(requested ? toIdentifier(camelCase(words(requested)), base) : base)
    const notes: string[] = []
    if (!choice.validated) {
      const status = choice.validation ? ` (${choice.validation.status})` : ''
      notes.push(`Unvalidated locator${status}: confirm it before relying on it.`)
    }
    if (choice.locator.stability === 'unstable') notes.push(`Unstable: ${choice.locator.stabilityReasons.at(-1)}`)
    properties.push({ elementId: el.id, name, locator: choice.locator, validated: choice.validated, notes })
  }

  const methods = options.includeMethods ? buildMethods(properties, byId, scan, nameFor) : []
  const code = render(className, properties, methods, scan, options, input.generatedAt ?? new Date())
  const extension = options.language === 'typescript' ? 'ts' : 'js'
  return {
    className,
    fileName: `${className}.${extension}`,
    code,
    properties,
    excluded,
    methods: methods.map((m) => m.name),
    methodDetails: methods.map(({ name, params }) => ({ name, params })),
  }
}

// ---------------------------------------------------------------------------
// Methods: only workflows the scanned page structure supports.
// ---------------------------------------------------------------------------

export type FieldAction = 'fill' | 'selectOption' | 'setChecked'

const TEXT_INPUT_TYPES = new Set(['text', 'email', 'password', 'search', 'tel', 'url', 'number', 'date', 'datetime-local', 'month', 'time', 'week'])

/** How a Page Object fills this element, or undefined when it is not fillable. */
export function fieldAction(el: ScannedElement): FieldAction | undefined {
  if (el.tagName === 'select') return 'selectOption'
  if (el.role === 'checkbox' || el.role === 'switch') return 'setChecked'
  if (el.tagName === 'textarea') return 'fill'
  if (el.tagName === 'input') return TEXT_INPUT_TYPES.has(el.properties.inputType ?? 'text') ? 'fill' : undefined
  if (el.role === 'textbox' || el.role === 'searchbox' || el.role === 'spinbutton' || el.hints.includes('contenteditable')) return 'fill'
  return undefined
}

function isSubmit(el: ScannedElement): boolean {
  const type = el.attributes.type?.toLowerCase()
  if (el.tagName === 'button') return !type || type === 'submit'
  return el.tagName === 'input' && (type === 'submit' || type === 'image')
}

const ACTION_WORDS = /\b(submit|log ?in|sign ?in|sign ?up|register|continue|next|send|search|go|save|apply|create|confirm)\b/i

/** A button outside a <form> that clearly submits something (not "open menu", "close"). */
function isNamedAction(el: ScannedElement): boolean {
  if (elementKind(el) !== 'button') return false
  const name = el.accessibleName ?? el.textContent ?? el.attributes.value ?? ''
  return ACTION_WORDS.test(name) || el.attributes.type?.toLowerCase() === 'submit'
}

function formOf(el: ScannedElement, byId: Map<string, ScannedElement>): ScannedElement | undefined {
  for (let p = el.parentId ? byId.get(el.parentId) : undefined; p; p = p.parentId ? byId.get(p.parentId) : undefined) {
    if (p.tagName === 'form') return p
  }
  return undefined
}

const PARAM_SUFFIXES = new Set(['input', 'select', 'checkbox', 'switch', 'field', 'textarea'])

function paramName(propertyName: string, taken: (n: string) => string): string {
  const ws = words(propertyName)
  if (ws.length > 1 && PARAM_SUFFIXES.has(ws[ws.length - 1]!.toLowerCase())) ws.pop()
  return taken(toIdentifier(camelCase(ws), 'value'))
}

function buildMethods(
  properties: PomProperty[],
  byId: Map<string, ScannedElement>,
  scan: ScanResult,
  nameFor: (n: string) => string,
): Method[] {
  const methods: Method[] = []

  // goto(): the scanned page, without query string or fragment (may hold session data).
  try {
    const url = new URL(scan.url)
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      methods.push({ name: nameFor('goto'), params: [], body: [`await this.page.goto(${jsString(url.origin + url.pathname)});`] })
    }
  } catch {
    // Not a navigable URL: no goto().
  }

  // One method per <form> with fillable fields and exactly one submit button.
  // Fields outside any <form> (common: <div id="form">) form one page-level group,
  // whose submit must be the only clearly named action button ("Submit", "Log in").
  const groups = new Map<ScannedElement | null, PomProperty[]>()
  for (const p of properties) {
    const form = formOf(byId.get(p.elementId)!, byId) ?? null
    groups.set(form, [...(groups.get(form) ?? []), p])
  }
  for (const [form, props] of groups) {
    const fields = props.flatMap((p) => {
      const el = byId.get(p.elementId)!
      const action = fieldAction(el)
      return action ? [{ p, el, action }] : []
    })
    const submits = props.filter((p) => {
      const el = byId.get(p.elementId)!
      return form ? isSubmit(el) : isNamedAction(el)
    })
    if (fields.length === 0 || submits.length !== 1) continue

    const isSearch = (el: ScannedElement) =>
      el.role === 'searchbox' || el.properties.inputType === 'search' || /search/i.test(`${el.accessibleName} ${el.attributes.name} ${el.attributes.placeholder}`)
    let base: string
    if (fields.some((f) => f.el.properties.inputType === 'password')) base = 'login'
    else if (fields.length === 1 && isSearch(fields[0]!.el)) base = 'search'
    else {
      const formWords = words(form?.accessibleName ?? form?.attributes.id ?? form?.attributes.name ?? '').filter((w) => !/^form$/i.test(w))
      base = camelCase(['submit', ...formWords.slice(0, 3), 'form'])
    }

    const paramFor = createNameRegistry()
    const params: Method['params'] = []
    const body: string[] = []
    for (const { p, action } of fields) {
      const param = base === 'search' && fields.length === 1 ? paramFor('query') : paramName(p.name, paramFor)
      params.push({ name: param, type: action === 'setChecked' ? 'boolean' : 'string', elementId: p.elementId })
      body.push(`await this.${p.name}.${action}(${param});`)
    }
    body.push(`await this.${submits[0]!.name}.click();`)
    methods.push({ name: nameFor(base), params, body })
  }
  return methods
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const comment = (text: string) => text.replace(/[\r\n]+/g, ' ')

function render(
  className: string,
  properties: PomProperty[],
  methods: Method[],
  scan: ScanResult,
  options: PomOptions,
  generatedAt: Date,
): string {
  const ts = options.language === 'typescript'
  const esm = ts || options.moduleFormat === 'esm'
  const validated = properties.filter((p) => p.validated).length
  const lines: string[] = [
    `// Generated by Locator Studio from ${comment(scan.url)}`,
    `// ${validated} of ${properties.length} locators validated against the live page (${generatedAt.toISOString().slice(0, 10)}).`,
  ]
  if (ts) lines.push(`import type { Locator, Page } from '@playwright/test';`)
  lines.push('', `${esm ? 'export ' : ''}class ${className} {`)

  if (ts) {
    lines.push('  readonly page: Page;')
    for (const p of properties) lines.push(`  readonly ${p.name}: Locator;`)
    lines.push('')
    lines.push('  constructor(page: Page) {')
  } else {
    lines.push('  /**', "   * @param {import('@playwright/test').Page} page", '   */', '  constructor(page) {')
  }
  lines.push('    this.page = page;')
  for (const p of properties) {
    for (const note of p.notes) lines.push(`    // ${comment(note)}`)
    lines.push(`    this.${p.name} = ${p.locator.expression};`)
  }
  lines.push('  }')

  for (const m of methods) {
    lines.push('')
    if (ts) {
      lines.push(`  async ${m.name}(${m.params.map((p) => `${p.name}: ${p.type}`).join(', ')}): Promise<void> {`)
    } else {
      if (m.params.length) {
        lines.push('  /**', ...m.params.map((p) => `   * @param {${p.type}} ${p.name}`), '   */')
      }
      lines.push(`  async ${m.name}(${m.params.map((p) => p.name).join(', ')}) {`)
    }
    for (const line of m.body) lines.push(`    ${line}`)
    lines.push('  }')
  }
  lines.push('}')
  if (!esm) lines.push('', `module.exports = { ${className} };`)
  return `${lines.join('\n')}\n`
}
