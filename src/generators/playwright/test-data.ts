// Sample test data for a generated Page Object. Values are synthetic and
// deterministic, chosen from each field's type, label and constraints. Nothing
// typed on the page is ever read (the scanner never collects values).
import { TEST_ID_ATTRIBUTES } from '../../shared/constants'
import type { ScannedElement, ScanResult } from '../../shared/types'
import { jsString } from '../../core/locator-engine/utils/escaping'
import { camelCase, words } from './naming'
import { fieldAction, type PomOptions, type PomResult } from './pom-generator'

export interface TestDataResult {
  fileName: string
  variableName: string
  code: string
  /** Sample value per Page Object property. */
  values: Record<string, string | boolean>
}

/** [keywords, value]: first match wins, so specific keywords come first. */
const BY_KEYWORD: [RegExp, string][] = [
  [/\b(e-?mail)\b/, 'test.user@example.com'],
  [/\b(pass(word)?|pwd)\b/, 'Test@12345'],
  [/\b(otp|one time|verification code|pin)\b/, '123456'],
  [/\b(cvv|cvc|security code)\b/, '123'],
  [/\b(card number|card|cc)\b/, '4111 1111 1111 1111'],
  [/\b(expiry|expiration|exp)\b/, '12/30'],
  [/\b(user ?name|login|user ?id|user)\b/, 'test.user'],
  [/\b(first ?name|given ?name|forename)\b/, 'Alex'],
  [/\b(last ?name|surname|family ?name)\b/, 'Morgan'],
  [/\b(phone|mobile|tel|telephone|cell)\b/, '+1 555 010 0199'],
  [/\b(url|website|web site|homepage|link)\b/, 'https://example.com'],
  [/\b(search|query|keyword|find)\b/, 'playwright'],
  [/\b(zip|postal|post ?code|postcode)\b/, '94105'],
  [/\b(city|town)\b/, 'Springfield'],
  [/\b(state|province|region)\b/, 'California'],
  [/\b(country)\b/, 'United States'],
  [/\b(address|street)\b/, '123 Test Street'],
  [/\b(company|organi[sz]ation|business)\b/, 'Example Ltd'],
  [/\b(job ?title|job|position)\b/, 'QA Engineer'],
  [/\b(age)\b/, '30'],
  [/\b(qty|quantity|count|amount|price|number)\b/, '1'],
  [/\b(message|comment|description|feedback|notes?|bio|about)\b/, 'This is a test message.'],
  [/\b(subject)\b/, 'Test subject'],
  [/\b(coupon|promo|voucher)\b/, 'TESTCODE'],
  // Generic last, so "company name" or "city name" match their specific rule first.
  [/\b(full ?name|your name|name)\b/, 'Alex Morgan'],
]

const BY_INPUT_TYPE: Record<string, string> = {
  email: 'test.user@example.com',
  password: 'Test@12345',
  tel: '+1 555 010 0199',
  url: 'https://example.com',
  search: 'playwright',
  date: '2030-01-15',
  time: '09:30',
  'datetime-local': '2030-01-15T09:30',
  month: '2030-01',
  week: '2030-W03',
  color: '#3366ff',
}

/** Words describing a field: label, name, id, placeholder, autocomplete. */
function describe(el: ScannedElement): string {
  const a = el.attributes
  const testAttr = TEST_ID_ATTRIBUTES.find((t) => a[t])
  return words(
    [el.accessibleName, a.name, a.id, a.placeholder, a.autocomplete, testAttr ? a[testAttr] : '']
      .filter(Boolean)
      .join(' '),
  )
    .join(' ')
    .toLowerCase()
}

function numberValue(el: ScannedElement): string {
  const min = Number(el.attributes.min)
  const max = Number(el.attributes.max)
  if (Number.isFinite(min)) return String(min)
  if (Number.isFinite(max)) return String(Math.min(1, max))
  return '1'
}

/** Applies minlength/maxlength so the sample passes the field's own constraints. */
function fitLength(value: string, el: ScannedElement): string {
  const max = Number(el.attributes.maxlength)
  const min = Number(el.attributes.minlength)
  let v = value
  if (Number.isFinite(min) && min > 0 && v.length < min) v = v.padEnd(min, 'x')
  if (Number.isFinite(max) && max > 0 && v.length > max) v = v.slice(0, max)
  return v
}

/** A select's first real option: its value attribute, or its text (selectOption accepts both). */
function selectValue(el: ScannedElement, elements: ScannedElement[]): string {
  const options = elements.filter((o) => o.tagName === 'option' && optionBelongsTo(o, el, elements))
  const real = options.find((o) => {
    const value = o.attributes.value ?? o.textContent ?? ''
    return value.trim() && !o.properties.disabled && !/^(select|choose|--|please)/i.test((o.textContent ?? value).trim())
  })
  return real ? (real.attributes.value ?? real.textContent ?? '').trim() : ''
}

function optionBelongsTo(option: ScannedElement, select: ScannedElement, elements: ScannedElement[]): boolean {
  if (option.parentId === select.id) return true
  const group = elements.find((g) => g.id === option.parentId)
  return group?.tagName === 'optgroup' && group.parentId === select.id
}

/** Synthetic sample value for one fillable element. */
export function sampleValue(el: ScannedElement, elements: ScannedElement[]): string | boolean | undefined {
  const action = fieldAction(el)
  if (!action) return undefined
  if (action === 'setChecked') return true
  if (action === 'selectOption') return selectValue(el, elements)

  const type = el.properties.inputType
  if (type === 'number' || el.role === 'spinbutton') return numberValue(el)
  const typed = type ? BY_INPUT_TYPE[type] : undefined
  if (typed) return fitLength(typed, el)

  const description = describe(el)
  const match = BY_KEYWORD.find(([pattern]) => pattern.test(description))
  if (match) return fitLength(match[1], el)
  if (el.tagName === 'textarea') return fitLength('This is a test message.', el)
  const label = words(el.accessibleName ?? el.attributes.name ?? '').slice(0, 3).join(' ').toLowerCase()
  return fitLength(label ? `Test ${label}` : 'Test value', el)
}

/**
 * Test data for the fillable properties of a generated Page Object: one entry
 * per field, plus the arguments for each generated method. Null when the Page
 * Object has nothing to fill.
 */
export function generateTestData(scan: ScanResult, pom: PomResult, options: Pick<PomOptions, 'language' | 'moduleFormat'>): TestDataResult | null {
  const byId = new Map(scan.elements.map((e) => [e.id, e]))
  const values: Record<string, string | boolean> = {}
  const byElement = new Map<string, string | boolean>()
  for (const p of pom.properties) {
    const value = sampleValue(byId.get(p.elementId)!, scan.elements)
    if (value === undefined) continue
    values[p.name] = value
    byElement.set(p.elementId, value)
  }
  if (Object.keys(values).length === 0) return null

  const ts = options.language === 'typescript'
  const esm = ts || options.moduleFormat === 'esm'
  const variableName = `${camelCase(words(pom.className))}Data`
  const literal = (v: string | boolean) => (typeof v === 'boolean' ? String(v) : jsString(v))
  const block = (name: string, entries: [string, string | boolean][]) => [
    `  ${name}: {`,
    ...entries.map(([k, v]) => `    ${k}: ${literal(v)},`),
    '  },',
  ]

  const methods = pom.methodDetails.filter((m) => m.params.length > 0 && m.params.every((p) => p.elementId && byElement.has(p.elementId)))
  const instance = camelCase(words(pom.className))
  const example = methods[0]
  const lines = [
    `// Sample test data for ${pom.className}, generated by Locator Studio.`,
    '// Synthetic values chosen from each field\'s type, label and constraints. Nothing was read from the page.',
    '// Replace them with data that is valid for your application.',
  ]
  if (example) {
    lines.push(
      '//',
      '// Usage:',
      `//   const ${instance} = new ${pom.className}(page);`,
      `//   await ${instance}.${example.name}(${example.params.map((p) => `${variableName}.${example.name}.${p.name}`).join(', ')});`,
    )
  }
  lines.push('', `${esm ? 'export ' : ''}const ${variableName} = {`)
  lines.push(...block('fields', Object.entries(values)))
  for (const m of methods) {
    lines.push(...block(m.name, m.params.map((p) => [p.name, byElement.get(p.elementId!)!] as [string, string | boolean])))
  }
  lines.push(ts ? '} as const;' : '};')
  if (!esm) lines.push('', `module.exports = { ${variableName} };`)

  return {
    fileName: `${pom.className}.data.${ts ? 'ts' : 'js'}`,
    variableName,
    code: `${lines.join('\n')}\n`,
    values,
  }
}
