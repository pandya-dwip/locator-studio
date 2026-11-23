// Test data for generated Playwright tests: scenario suggestions, scenario
// checks and the <Name>TestData file. Values are entered by the user or are
// clearly marked placeholders / synthetic samples. Nothing is read from the page.
import { TEST_ID_ATTRIBUTES } from '../../shared/constants'
import type { PageTestData, ScannedElement, TestScenario } from '../../shared/types'
import { jsString } from '../../core/locator-engine/utils/escaping'
import type { FormParam, FormSpec } from './forms'
import { camelCase, pascalCase, words } from './naming'
import { comment, paramType, type ModuleFormat } from './pom-generator'
import type { OutputLanguage } from '../../shared/types'

/** Values starting with this are placeholders: tests using them are skipped until replaced. */
export const PLACEHOLDER = 'YOUR_'

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

const BY_KIND: Partial<Record<FormParam['kind'], string>> = {
  email: 'test.user@example.com',
  password: 'Test@12345',
  tel: '+1 555 010 0199',
  url: 'https://example.com',
  search: 'playwright',
  date: '2030-01-15',
  textarea: 'This is a test message.',
}

/** Words describing a field: label, name, id, placeholder, autocomplete. */
function describe(p: FormParam, elements: Map<string, ScannedElement>): string {
  const el = elements.get(p.elementIds[0]!)
  const a = el?.attributes ?? {}
  const testAttr = TEST_ID_ATTRIBUTES.find((t) => a[t])
  return words([p.label, p.name, a.name, a.id, a.placeholder, a.autocomplete, testAttr ? a[testAttr] : ''].filter(Boolean).join(' '))
    .join(' ')
    .toLowerCase()
}

/** Applies minlength/maxlength so the sample passes the field's own constraints. */
function fitLength(value: string, p: FormParam): string {
  const { minLength: min, maxLength: max } = p.constraints
  let v = value
  if (min && v.length < min) v = v.padEnd(min, 'x')
  if (max && v.length > max) v = v.slice(0, max)
  return v
}

/** First real option of a select (not a "Select…" placeholder). */
function firstOption(p: FormParam): string {
  const real = p.options.find((o) => o.value && !/^(select|choose|--|please)/i.test(o.label || o.value))
  return real?.value ?? p.options[0]?.value ?? ''
}

/** A synthetic, valid-looking value for one parameter. */
export function sampleValue(p: FormParam, elements: Map<string, ScannedElement>): string | boolean {
  if (p.kind === 'checkbox') return true
  if (p.kind === 'select' || p.kind === 'radio') return firstOption(p)
  if (p.kind === 'number') return String(p.constraints.min ?? (p.constraints.max !== undefined ? Math.min(1, p.constraints.max) : 1))
  const byKind = BY_KIND[p.kind]
  if (byKind && p.kind !== 'textarea') return fitLength(byKind, p)
  const match = BY_KEYWORD.find(([pattern]) => pattern.test(describe(p, elements)))
  if (match) return fitLength(match[1], p)
  return fitLength(byKind ?? `Test ${p.label.toLowerCase()}`, p)
}

const placeholderFor = (p: FormParam) => `${PLACEHOLDER}VALID_${words(p.name).join('_').toUpperCase()}`
const isTextual = (p: FormParam) => p.type === 'string' && p.kind !== 'select' && p.kind !== 'radio'

/**
 * Suggested scenarios for a form: a valid case plus negative and boundary
 * cases. Account-specific values are placeholders, never invented credentials.
 */
export function suggestScenarios(form: FormSpec, elements: ScannedElement[]): TestScenario[] {
  const byId = new Map(elements.map((e) => [e.id, e]))
  const sample = Object.fromEntries(form.params.map((p) => [p.name, sampleValue(p, byId)])) as Record<string, string | boolean>
  let n = 0
  const make = (name: string, values: Record<string, string | boolean>, expected: TestScenario['expected']): TestScenario => ({
    id: `suggested-${form.method}-${++n}`,
    name,
    values,
    expected,
  })

  if (form.kind === 'login') {
    const password = form.params.find((p) => p.kind === 'password')!
    const identity = form.params.find((p) => p !== password && isTextual(p))
    const valid = { ...sample, [password.name]: placeholderFor(password), ...(identity ? { [identity.name]: placeholderFor(identity) } : {}) }
    const badIdentity = identity?.kind === 'email' ? 'invalid.user@example.com' : 'invalid_user'
    const out = [make('Valid credentials', valid, 'success')]
    if (identity) {
      const label = identity.label.toLowerCase()
      out.push(
        make('Invalid credentials', { ...valid, [identity.name]: badIdentity, [password.name]: 'invalid_password' }, 'failure'),
        make(`Invalid ${label}`, { ...valid, [identity.name]: badIdentity }, 'failure'),
        make('Invalid password', { ...valid, [password.name]: 'invalid_password' }, 'failure'),
        make(`Empty ${label}`, { ...valid, [identity.name]: '', [password.name]: 'invalid_password' }, 'failure'),
        make('Empty password', { ...valid, [identity.name]: badIdentity, [password.name]: '' }, 'failure'),
      )
    } else {
      out.push(make('Invalid password', { ...valid, [password.name]: 'invalid_password' }, 'failure'), make('Empty password', { ...valid, [password.name]: '' }, 'failure'))
    }
    return out
  }

  const out = [make(form.kind === 'search' ? 'Search' : 'Valid submission', sample, 'success')]
  if (form.kind === 'search') return out
  for (const p of form.params) {
    const label = p.label.toLowerCase()
    if (p.required && isTextual(p)) out.push(make(`Empty ${label}`, { ...sample, [p.name]: '' }, 'failure'))
    if (p.kind === 'email') out.push(make(`Invalid ${label} format`, { ...sample, [p.name]: 'not-an-email' }, 'failure'))
    const { minLength, maxLength, min, max } = p.constraints
    if (isTextual(p) && minLength && minLength > 1) out.push(make(`${p.label} shorter than ${minLength} characters`, { ...sample, [p.name]: 'x'.repeat(minLength - 1) }, 'failure'))
    if (isTextual(p) && maxLength) out.push(make(`${p.label} longer than ${maxLength} characters`, { ...sample, [p.name]: 'x'.repeat(maxLength + 1) }, 'failure'))
    if (p.kind === 'number' && min !== undefined) out.push(make(`${p.label} below ${min}`, { ...sample, [p.name]: String(min - 1) }, 'failure'))
    if (p.kind === 'number' && max !== undefined) out.push(make(`${p.label} above ${max}`, { ...sample, [p.name]: String(max + 1) }, 'failure'))
  }
  return out
}

/**
 * Why a scenario cannot run as a meaningful test yet. The generated spec
 * applies the same rules at runtime (and skips with the reason).
 */
export function scenarioIssues(s: TestScenario, form: FormSpec): string[] {
  const issues: string[] = []
  const all = { ...s.values, expectedUrl: s.expectedUrl ?? '', expectedText: s.expectedText ?? '' }
  const placeholders = Object.entries(all).filter(([, v]) => typeof v === 'string' && v.startsWith(PLACEHOLDER)).map(([k]) => k)
  if (placeholders.length) issues.push(`Replace the ${PLACEHOLDER}… placeholder in ${placeholders.join(', ')}`)
  if (s.expected === 'success' && !s.expectedUrl && !s.expectedText) issues.push('Set an expected URL or expected text for this success case')
  if (s.expected === 'failure' && !form.message && !s.expectedText) {
    issues.push('Set the expected error text (no error message element was found on the page)')
  }
  for (const p of form.params) {
    const v = s.values[p.name]
    if (v === undefined) issues.push(`Missing value for ${p.name}`)
    else if (p.kind === 'radio' && !p.options.some((o) => o.value === v)) issues.push(`${p.name} must be one of ${p.options.map((o) => o.value).join(', ')}`)
  }
  if (!s.name.trim()) issues.push('Give the scenario a name')
  return issues
}

export interface TestDataNames {
  pageInfo: string
  caseType: (form: FormSpec) => string
  data: (form: FormSpec) => string
}

export function testDataNames(baseName: string): TestDataNames {
  return {
    pageInfo: `${camelCase(words(baseName))}PageInfo`,
    caseType: (f) => `${pascalCase(words(f.method))}TestCase`,
    data: (f) => `${f.method}TestData`,
  }
}

/** The <Name>TestData file: page details plus one typed array of cases per form. */
export function renderTestData(o: {
  baseName: string
  className: string
  specFile: string
  dataFile: string
  title: string
  forms: FormSpec[]
  scenarios: PageTestData
  language: OutputLanguage
  moduleFormat: ModuleFormat
}): string {
  const ts = o.language === 'typescript'
  const esm = ts || o.moduleFormat === 'esm'
  const names = testDataNames(o.baseName)
  const exported: string[] = [names.pageInfo]
  const lines: string[] = [
    `// Test data for ${o.className}, used by ${o.specFile}.`,
    `// Edit freely. Values starting with "${PLACEHOLDER}" are placeholders: the tests that use them are skipped until you replace them.`,
    '// Written by Locator Studio from your scenarios. Nothing here was read from the page.',
    '',
    '/** Expected page details. */',
    `${esm ? 'export ' : ''}const ${names.pageInfo} = {`,
    `  title: ${jsString(o.title)},`,
    '};',
  ]
  if (o.forms.length && ts) {
    lines.push('', "export type ExpectedOutcome = 'success' | 'failure';")
  }
  for (const f of o.forms) {
    const caseType = names.caseType(f)
    const fields = [
      { name: 'name', type: 'string', doc: 'Test title.' },
      ...f.params.map((p) => ({ name: p.name, type: paramType(p), doc: `${p.label}${p.required ? ' (required)' : ''}` })),
      { name: 'expected', type: ts ? 'ExpectedOutcome' : "'success' | 'failure'", doc: "'success': expectedUrl and/or expectedText must appear. 'failure': the error must appear." },
      { name: 'expectedUrl', type: 'string', doc: 'Part of the URL after submitting.', optional: true },
      { name: 'expectedText', type: 'string', doc: 'Text visible after submitting (for failures: the error message).', optional: true },
    ] as { name: string; type: string; doc: string; optional?: boolean }[]
    lines.push('')
    if (ts) {
      lines.push(`/** One run of ${o.className}.${f.method}(). */`, `export interface ${caseType} {`)
      for (const fd of fields) lines.push(`  /** ${comment(fd.doc)} */`, `  ${fd.name}${fd.optional ? '?' : ''}: ${fd.type};`)
      lines.push('}')
    } else {
      lines.push('/**', ` * One run of ${o.className}.${f.method}().`, ` * @typedef {object} ${caseType}`)
      for (const fd of fields) lines.push(` * @property {${fd.type}} ${fd.optional ? `[${fd.name}]` : fd.name} ${comment(fd.doc)}`)
      lines.push(' */')
    }

    lines.push('')
    if (!ts) lines.push(`/** @type {${caseType}[]} */`)
    lines.push(`${esm ? 'export ' : ''}const ${names.data(f)}${ts ? `: ${caseType}[]` : ''} = [`)
    for (const s of o.scenarios[f.method] ?? []) {
      lines.push('  {', `    name: ${jsString(s.name)},`)
      for (const p of f.params) {
        const v = s.values[p.name] ?? (p.type === 'boolean' ? false : '')
        lines.push(`    ${p.name}: ${typeof v === 'boolean' ? String(v) : jsString(v)},`)
      }
      lines.push(`    expected: ${jsString(s.expected)},`)
      if (s.expectedUrl) lines.push(`    expectedUrl: ${jsString(s.expectedUrl)},`)
      if (s.expectedText) lines.push(`    expectedText: ${jsString(s.expectedText)},`)
      lines.push('  },')
    }
    lines.push('];')
    exported.push(names.data(f))
  }
  if (!esm) lines.push('', `module.exports = { ${exported.join(', ')} };`)
  return `${lines.join('\n')}\n`
}
