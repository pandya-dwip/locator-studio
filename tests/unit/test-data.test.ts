import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { transformWithOxc } from 'vite'
import { generateLocators } from '../../src/core/locator-engine'
import { scanDocument } from '../../src/core/scanner'
import { validateLocators } from '../../src/core/validator'
import { generatePom, generateTestData, isPomEligible, sampleValue, type PomOptions } from '../../src/generators/playwright'
import type { GeneratedLocator, LocatorValidationResult, ScanResult } from '../../src/shared/types'

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, left: 0, width: 100, height: 20, right: 100, bottom: 20, toJSON() {} } as DOMRect)
})
afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

const SIGNUP = `
  <form id="signup">
    <label for="email">Work email</label><input id="email" name="email" type="email" value="real@user.com">
    <label for="pw">Password</label><input id="pw" name="pw" type="password" minlength="12">
    <label for="first">First name</label><input id="first" name="firstName">
    <label for="company">Company name</label><input id="company" name="company" maxlength="5">
    <label for="phone">Phone</label><input id="phone" type="tel" name="phone">
    <label for="age">Age</label><input id="age" type="number" name="age" min="18">
    <label for="start">Start date</label><input id="start" type="date" name="start">
    <label for="country">Country</label>
    <select id="country" name="country"><option value="">Select a country</option><option value="de">Germany</option></select>
    <label for="bio">About you</label><textarea id="bio" name="bio">my private notes</textarea>
    <label><input type="checkbox" name="terms"> I accept the terms</label>
    <label for="nick">Nickname</label><input id="nick" name="nick">
    <button type="submit">Create account</button>
  </form>`

function prepare(html: string) {
  document.body.innerHTML = html
  const { result, elements } = scanDocument(document)
  const scan: ScanResult = { ...result, url: 'https://app.example.test/signup', title: 'Sign up' }
  const locators = generateLocators(scan.elements)
  const items = [...locators.values()].flatMap((r) => r.locators.map((l) => ({ locatorId: l.id, elementId: r.elementId, expression: l.expression, query: l.query })))
  const validations = new Map<string, LocatorValidationResult>(validateLocators(document, items, (id) => elements.get(id)).map((v) => [v.locatorId, v]))
  const validationOf = (l: GeneratedLocator) => validations.get(l.id)
  return { scan, locators, validationOf }
}

const OPTIONS: PomOptions = { language: 'typescript', moduleFormat: 'commonjs', className: 'SignupPage', includeMethods: true, allowUnvalidated: false }

function build(options: Partial<PomOptions> = {}) {
  const ctx = prepare(SIGNUP)
  const pom = generatePom({ ...ctx, elementIds: ctx.scan.elements.filter(isPomEligible).map((e) => e.id), options: { ...OPTIONS, ...options } })
  const data = generateTestData(ctx.scan, pom, { ...OPTIONS, ...options })!
  return { ...ctx, pom, data }
}

describe('sample values', () => {
  it('chooses values from type, label and constraints', () => {
    const { data } = build()
    expect(data.values).toEqual({
      workEmailInput: 'test.user@example.com',
      passwordInput: 'Test@12345xx', // padded to minlength 12
      firstNameInput: 'Alex',
      companyNameInput: 'Examp', // "company name" → company, cut to maxlength 5
      phoneInput: '+1 555 010 0199',
      ageInput: '18', // number min
      startDateInput: '2030-01-15',
      countrySelect: 'de', // first real option, not the placeholder
      aboutYouInput: 'This is a test message.',
      iAcceptTheTermsCheckbox: true,
      nicknameInput: 'Test nickname',
    })
  })

  it('never uses what is typed on the page', () => {
    const { data } = build()
    expect(data.code).not.toContain('real@user.com')
    expect(data.code).not.toContain('my private notes')
  })

  it('returns nothing for elements that cannot be filled', () => {
    const ctx = prepare('<button>Go</button>')
    expect(sampleValue(ctx.scan.elements[0]!, ctx.scan.elements)).toBeUndefined()
  })
})

describe('test data file', () => {
  it('TypeScript: exported const with fields and method arguments, matching the POM', async () => {
    const { pom, data } = build()
    expect(data.fileName).toBe('SignupPage.data.ts')
    expect(data.variableName).toBe('signupPageData')
    expect(data.code).toContain('export const signupPageData = {')
    expect(data.code).toContain('} as const;')
    // The generated method and the data agree on parameter names.
    const method = pom.methodDetails.find((m) => m.params.length > 0)!
    expect(data.code).toContain(`  ${method.name}: {`)
    for (const p of method.params) expect(data.code).toContain(`    ${p.name}: `)
    expect(data.code).toContain(`//   await signupPage.${method.name}(`)

    // Run POM + data together: the method fills every field with the sample data.
    const strip = async (code: string, file: string) =>
      (await transformWithOxc(code, file)).code.replace(/^import .*$/gm, '').replace(/^export /gm, '')
    const js = `${await strip(pom.code, 'p.ts')}\n${await strip(data.code, 'd.ts')}\nreturn { SignupPage, signupPageData }`
    const { SignupPage, signupPageData } = new Function(js)()
    const calls: string[] = []
    const page = new Proxy({}, { get: (_t, m: string) => (...a: unknown[]) => new Proxy({}, { get: (_x, action: string) => async (...v: unknown[]) => calls.push(`${m}(${JSON.stringify(a[0])}).${action}(${JSON.stringify(v[0])})`) }) })
    const instance = new SignupPage(page)
    const args = method.params.map((p) => signupPageData[method.name][p.name])
    await instance[method.name](...args)
    expect(calls).toContain(`getByRole("textbox").fill("test.user@example.com")`.replace('getByRole("textbox")', calls.find((c) => c.includes('test.user@example.com'))!.split('.fill')[0]!))
    expect(calls.some((c) => c.endsWith('.selectOption("de")'))).toBe(true)
    expect(calls.some((c) => c.endsWith('.setChecked(true)'))).toBe(true)
    expect(calls.at(-1)).toMatch(/\.click\(undefined\)$/)
  })

  it('JavaScript: CommonJS and ES module variants', () => {
    const cjs = build({ language: 'javascript' }).data
    expect(cjs.fileName).toBe('SignupPage.data.js')
    expect(cjs.code).toContain('const signupPageData = {')
    expect(cjs.code).toContain('module.exports = { signupPageData };')
    expect(cjs.code).not.toContain('as const')
    const module = { exports: {} as Record<string, unknown> }
    new Function('module', cjs.code)(module)
    expect((module.exports.signupPageData as { fields: Record<string, unknown> }).fields.workEmailInput).toBe('test.user@example.com')

    const esm = build({ language: 'javascript', moduleFormat: 'esm' }).data
    expect(esm.code).toContain('export const signupPageData = {')
    expect(esm.code).not.toContain('module.exports')
  })

  it('only field values when methods are off, and null when nothing is fillable', () => {
    const { data } = build({ includeMethods: false })
    expect(data.code).toContain('  fields: {')
    expect(data.code).not.toMatch(/^ {2}(submit|login)\w*: \{/m)
    expect(data.code).not.toContain('Usage:')

    const ctx = prepare('<a href="/x">Docs</a>')
    const pom = generatePom({ ...ctx, elementIds: ctx.scan.elements.map((e) => e.id), options: OPTIONS })
    expect(generateTestData(ctx.scan, pom, OPTIONS)).toBeNull()
  })
})
