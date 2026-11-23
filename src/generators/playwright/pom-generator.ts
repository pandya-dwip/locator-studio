// Playwright Page Object class generator. Pure: structured scan, locator and
// validation data in, source code out. No DOM, no React.
import { elementKind } from '../../shared/element-kind'
import { isMessage } from '../../shared/relevance'
import type {
  ElementLocatorResult,
  GeneratedLocator,
  OutputLanguage,
  ScannedElement,
  ScanResult,
} from '../../shared/types'
import { jsString } from '../../core/locator-engine/utils/escaping'
import { detectForms, type FormSpec } from './forms'
import { basePropertyName, camelCase, createNameRegistry, defaultClassName, sanitizeClassName, toIdentifier, words } from './naming'
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

export interface PomMethodInfo {
  name: string
  params: { name: string; type: string; elementId?: string }[]
}

export interface PomResult {
  className: string
  fileName: string
  code: string
  /** http(s) page URL without query or fragment, when navigable. */
  url?: string
  properties: PomProperty[]
  excluded: PomExclusion[]
  /** Forms whose submission the page class supports (empty when methods are off). */
  forms: FormSpec[]
  /** Properties checked by expectLoaded() (visible when scanned). */
  loadedChecks: string[]
  methods: string[]
  methodDetails: PomMethodInfo[]
}

/** Elements a Page Object usually exposes: buttons, links, form fields, headings and status messages. */
export function isPomEligible(el: ScannedElement): boolean {
  if (['option', 'optgroup', 'datalist'].includes(el.tagName)) return false
  const kind = elementKind(el)
  return kind === 'button' || kind === 'link' || kind === 'field' || el.role === 'heading' || isMessage(el)
}

export function elementLabel(el: ScannedElement): string {
  const text = el.accessibleName ?? el.textContent ?? (el.attributes.id ? `#${el.attributes.id}` : '')
  return `<${el.tagName}>${text ? ` ${text}` : ''}`
}

/** The page URL a test navigates to: http(s) only, without query string or fragment (may hold session data). */
export function pageUrl(url: string): string | undefined {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin + u.pathname : undefined
  } catch {
    return undefined
  }
}

/** Type annotation for a form parameter: radios become a union of their values. */
export function paramType(p: FormSpec['params'][number]): string {
  return p.kind === 'radio' ? p.options.map((o) => jsString(o.value)).join(' | ') || 'string' : p.type
}

export function generatePom(input: PomInput): PomResult {
  const { scan, options } = input
  // An empty class name means: derive it from the page title (or URL).
  const className = options.className.trim() ? sanitizeClassName(options.className) : defaultClassName(scan.title, scan.url)
  const wanted = new Set(input.elementIds)
  const byId = new Map(scan.elements.map((e) => [e.id, e]))
  // Class members that are not locators.
  const nameFor = createNameRegistry(['page', 'url', 'goto', 'expectLoaded'])

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

  const url = pageUrl(scan.url)
  const forms = options.includeMethods ? detectForms(properties, scan.elements, nameFor) : []
  // expectLoaded(): elements that were visible when scanned, form controls first.
  const visible = properties.filter((p) => {
    const el = byId.get(p.elementId)!
    return (el.visibility === 'visible' || el.visibility === 'obscured') && !isMessage(el)
  })
  const formMembers = new Set(forms.flatMap((f) => [f.submit, ...f.params.flatMap((p) => (p.property ? [p.property] : Object.values(p.radioProperties ?? {})))]))
  const loadedChecks = [...visible.filter((p) => formMembers.has(p.name)), ...visible.filter((p) => !formMembers.has(p.name))]
    .slice(0, 6)
    .map((p) => p.name)

  const methods: PomMethodInfo[] = [
    ...(url ? [{ name: 'goto', params: [] }] : []),
    ...forms.map((f) => ({ name: f.method, params: f.params.map((p) => ({ name: p.name, type: paramType(p), elementId: p.elementIds[0] })) })),
  ]
  const code = renderPageClass({ className, properties, forms, loadedChecks, url, options, scan, generatedAt: input.generatedAt ?? new Date() })
  const extension = options.language === 'typescript' ? 'ts' : 'js'
  return {
    className,
    fileName: `${className}.${extension}`,
    code,
    url,
    properties,
    excluded,
    forms,
    loadedChecks,
    methods: [...methods.map((m) => m.name), ...(loadedChecks.length ? ['expectLoaded'] : [])],
    methodDetails: methods,
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export const comment = (text: string) => text.replace(/[\r\n]+/g, ' ')

function formBody(f: FormSpec): string[] {
  const body: string[] = []
  for (const p of f.params) {
    if (p.kind === 'radio') {
      const choices = Object.entries(p.radioProperties ?? {}).map(([value, prop]) => `${jsString(value)}: this.${prop}`)
      body.push(`await ({ ${choices.join(', ')} })[${p.name}].check();`)
    } else {
      body.push(`await this.${p.property}.${p.action}(${p.name});`)
    }
  }
  body.push(`await this.${f.submit}.click();`)
  return body
}

function renderPageClass(o: {
  className: string
  properties: PomProperty[]
  forms: FormSpec[]
  loadedChecks: string[]
  url?: string
  options: PomOptions
  scan: ScanResult
  generatedAt: Date
}): string {
  const ts = o.options.language === 'typescript'
  const esm = ts || o.options.moduleFormat === 'esm'
  const needsExpect = o.loadedChecks.length > 0
  const validated = o.properties.filter((p) => p.validated).length
  const unvalidated = o.properties.length - validated
  const lines: string[] = [
    `// Page Object for ${comment(o.url ?? o.scan.url)}`,
    `// Generated by Locator Studio on ${o.generatedAt.toISOString().slice(0, 10)}: ${validated} of ${o.properties.length} locators validated against the live page${unvalidated ? ` (${unvalidated} unvalidated, marked below)` : ''}.`,
  ]
  if (ts) lines.push(needsExpect ? `import { expect, type Locator, type Page } from '@playwright/test';` : `import type { Locator, Page } from '@playwright/test';`)
  else if (needsExpect) lines.push(esm ? `import { expect } from '@playwright/test';` : `const { expect } = require('@playwright/test');`)
  lines.push('', `${esm ? 'export ' : ''}class ${o.className} {`)

  if (o.url) lines.push(`  ${ts ? 'static readonly' : 'static'} url = ${jsString(o.url)};`, '')
  if (ts) {
    lines.push('  readonly page: Page;')
    for (const p of o.properties) lines.push(`  readonly ${p.name}: Locator;`)
    lines.push('', '  constructor(page: Page) {')
  } else {
    lines.push('  /**', "   * @param {import('@playwright/test').Page} page", '   */', '  constructor(page) {')
  }
  lines.push('    this.page = page;')
  for (const p of o.properties) {
    for (const note of p.notes) lines.push(`    // ${comment(note)}`)
    lines.push(`    this.${p.name} = ${p.locator.expression};`)
  }
  lines.push('  }')

  const method = (doc: string, name: string, params: { name: string; type: string }[], body: string[]) => {
    lines.push('', `  /** ${doc} */`)
    if (ts) {
      lines.push(`  async ${name}(${params.map((p) => `${p.name}: ${p.type}`).join(', ')}): Promise<void> {`)
    } else {
      if (params.length) {
        lines.pop()
        lines.push('  /**', `   * ${doc}`, ...params.map((p) => `   * @param {${p.type}} ${p.name}`), '   */')
      }
      lines.push(`  async ${name}(${params.map((p) => p.name).join(', ')}) {`)
    }
    for (const line of body) lines.push(`    ${line}`)
    lines.push('  }')
  }

  if (o.url) method('Opens the page.', 'goto', [], [`await this.page.goto(${o.className}.url);`])
  for (const f of o.forms) {
    method(
      `Fills the ${f.title.toLowerCase()} form and submits it.`,
      f.method,
      f.params.map((p) => ({ name: p.name, type: paramType(p) })),
      formBody(f),
    )
  }
  if (needsExpect) {
    method('Asserts that the key elements of the page are visible.', 'expectLoaded', [], o.loadedChecks.map((n) => `await expect(this.${n}).toBeVisible();`))
  }
  lines.push('}')
  if (!esm) lines.push('', `module.exports = { ${o.className} };`)
  return `${lines.join('\n')}\n`
}
