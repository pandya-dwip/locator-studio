import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { transformWithOxc } from 'vite'
import { generateLocators } from '../../src/core/locator-engine'
import { scanDocument } from '../../src/core/scanner'
import { validateLocators } from '../../src/core/validator'
import { generatePom, isPomEligible, sanitizeClassName, defaultClassName, type PomOptions } from '../../src/generators/playwright'
import type { GeneratedLocator, LocatorValidationResult, ScanResult } from '../../src/shared/types'

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, left: 0, width: 100, height: 20, right: 100, bottom: 20, toJSON() {} } as DOMRect)
})
afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

const PAGE = `
  <form id="login" aria-label="Sign in">
    <label for="email">Email</label><input id="email" name="email" type="email">
    <label for="password">Password</label><input id="password" name="password" type="password">
    <label><input type="checkbox" name="remember"> Remember me</label>
    <button type="submit">Log in</button>
  </form>
  <a href="/forgot">Forgot password?</a>
  <h1>Welcome</h1>
  <p>Some intro text here</p>
  <select name="country"><option>Andorra</option></select>
  <button id="save-a">Save</button><button id="save-b">Save</button>
  <button id="publish">Publish</button><button>Publish later</button>
  <img src="/logo.png" alt="Company logo">`

/** Scan → generate → validate everything against the jsdom page, like the workspace does. */
function prepare(html = PAGE, { validate = true } = {}) {
  document.body.innerHTML = html
  const { result, elements } = scanDocument(document)
  const scan: ScanResult = { ...result, url: 'https://shop.example.test/account/login?session=abc#top', title: 'Sign in | Example Shop' }
  const locators = generateLocators(scan.elements)
  const validations = new Map<string, LocatorValidationResult>()
  if (validate) {
    const items = [...locators.values()].flatMap((r) => r.locators.map((l) => ({ locatorId: l.id, elementId: r.elementId, expression: l.expression, query: l.query })))
    for (const v of validateLocators(document, items, (id) => elements.get(id))) validations.set(v.locatorId, v)
  }
  const validationOf = (l: GeneratedLocator) => {
    const v = validations.get(l.id)
    return v?.expression === l.expression ? v : undefined
  }
  const id = (pred: (e: ScanResult['elements'][number]) => boolean) => scan.elements.find(pred)!.id
  const allEligible = scan.elements.filter(isPomEligible).map((e) => e.id)
  return { scan, locators, validations, validationOf, id, allEligible }
}

const OPTIONS: PomOptions = { language: 'typescript', moduleFormat: 'commonjs', className: 'LoginPage', includeMethods: true, allowUnvalidated: false }

function pom(ctx: ReturnType<typeof prepare>, elementIds: string[], options: Partial<PomOptions> = {}) {
  return generatePom({ scan: ctx.scan, elementIds, locators: ctx.locators, validationOf: ctx.validationOf, options: { ...OPTIONS, ...options }, generatedAt: new Date('2026-01-02T00:00:00Z') })
}

interface Recorded {
  calls: string[]
  instance: Record<string, unknown>
}

/** Runs generated code (TS is stripped by oxc, which also rejects syntax errors) against a recording fake page. */
async function execute(code: string, className: string, language: 'typescript' | 'javascript', moduleFormat = 'commonjs'): Promise<Recorded> {
  let js = code
  if (language === 'typescript' || moduleFormat === 'esm') {
    js = (await transformWithOxc(code, language === 'typescript' ? 'Page.ts' : 'Page.mjs')).code
    js = js.replace(/^import .*$/gm, '').replace(/^export /gm, '')
  }
  const module = { exports: {} as Record<string, unknown> }
  const Cls = new Function('module', `${js}\nreturn typeof ${className} === 'function' ? ${className} : module.exports.${className};`)(module) as new (page: unknown) => Record<string, unknown>
  const calls: string[] = []
  const locator = (desc: string) => new Proxy({}, { get: (_t, action: string) => async (...args: unknown[]) => calls.push(`${desc}.${action}(${args.map((a) => JSON.stringify(a)).join(', ')})`) })
  const page = new Proxy({}, { get: (_t, method: string) => (...args: unknown[]) => {
    const desc = `${method}(${args.map((a) => JSON.stringify(a)).join(', ')})`
    if (method === 'goto') { calls.push(desc); return Promise.resolve() }
    return locator(desc)
  } })
  return { calls, instance: new Cls(page) }
}

const propertyNames = (code: string) => [...code.matchAll(/this\.(\w+) = page\./g)].map((m) => m[1]!)

describe('output languages', () => {
  it('TypeScript: type-only Playwright import, readonly fields, exported class, valid syntax', async () => {
    const ctx = prepare()
    const r = pom(ctx, ctx.allEligible)
    expect(r.fileName).toBe('LoginPage.ts')
    expect(r.code).toContain("import type { Locator, Page } from '@playwright/test';")
    expect(r.code).toContain('export class LoginPage {')
    expect(r.code).toContain('  readonly page: Page;')
    expect(r.code).toContain('  readonly emailInput: Locator;')
    expect(r.code).toContain('  constructor(page: Page) {')
    const { instance } = await execute(r.code, 'LoginPage', 'typescript')
    for (const p of r.properties) expect(instance[p.name], p.name).toBeDefined()
  })

  it('JavaScript (CommonJS by default) has no TypeScript syntax and exports the class', async () => {
    const ctx = prepare()
    const r = pom(ctx, ctx.allEligible, { language: 'javascript' })
    expect(r.fileName).toBe('LoginPage.js')
    expect(r.code).not.toMatch(/readonly|: Locator|: Page|import type/)
    expect(r.code).toContain('class LoginPage {')
    expect(r.code).toContain('module.exports = { LoginPage };')
    const { instance } = await execute(r.code, 'LoginPage', 'javascript')
    expect(Object.keys(instance)).toEqual(['page', ...r.properties.map((p) => p.name)])
  })

  it('JavaScript ES module', async () => {
    const ctx = prepare()
    const r = pom(ctx, ctx.allEligible, { language: 'javascript', moduleFormat: 'esm' })
    expect(r.code).toContain('export class LoginPage {')
    expect(r.code).not.toContain('module.exports')
    await execute(r.code, 'LoginPage', 'javascript', 'esm')
  })
})

describe('element scope', () => {
  it('selected elements only, in document order', () => {
    const ctx = prepare()
    const ids = [ctx.id((e) => e.tagName === 'h1'), ctx.id((e) => e.attributes.id === 'email')]
    const r = pom(ctx, ids, { includeMethods: false })
    expect(r.properties.map((p) => p.name)).toEqual(['emailInput', 'welcomeHeading'])
  })

  it('all eligible: buttons, links, form fields and headings, not paragraphs, images or options', () => {
    const ctx = prepare()
    const r = pom(ctx, ctx.allEligible, { includeMethods: false })
    expect(r.properties.map((p) => p.name)).toEqual([
      'emailInput', 'passwordInput', 'rememberMeCheckbox', 'logInButton', 'forgotPasswordLink', 'welcomeHeading', 'countrySelect', 'saveButton', 'saveButton2', 'publishButton', 'publishLaterButton',
    ])
  })

  it('empty selection produces a valid class with only the page', async () => {
    const ctx = prepare()
    const r = pom(ctx, [])
    expect(r.properties).toEqual([])
    expect(r.methods).toEqual(['goto'])
    await execute(r.code, 'LoginPage', 'typescript')
  })
})

describe('naming', () => {
  it('deduplicates property names deterministically and never declares a property twice', () => {
    const ctx = prepare()
    const r = pom(ctx, ctx.allEligible)
    const names = propertyNames(r.code)
    expect(names.filter((n) => n.startsWith('saveButton'))).toEqual(['saveButton', 'saveButton2'])
    expect(new Set(names).size).toBe(names.length)
    expect(new Set([...names, ...r.methods]).size).toBe(names.length + r.methods.length)
  })

  it('names images from alt text without doubling the suffix', () => {
    const ctx = prepare()
    expect(pom(ctx, [ctx.id((e) => e.tagName === 'img')]).properties[0]!.name).toBe('companyLogo')
  })

  it('sanitises class names', () => {
    expect(sanitizeClassName('login')).toBe('LoginPage')
    expect(sanitizeClassName('checkout page')).toBe('CheckoutPage')
    expect(sanitizeClassName('123 my page!!')).toBe('Page123MyPage')
    expect(sanitizeClassName('')).toBe('GeneratedPage')
    expect(sanitizeClassName('class')).toBe('ClassPage')
    expect(defaultClassName('Sign in | Example Shop', 'https://x.test/')).toBe('SignInPage')
    expect(defaultClassName('', 'https://x.test/account/settings.html')).toBe('SettingsPage')
  })

  it('avoids reserved words in property names, including user-provided ones', async () => {
    const ctx = prepare('<h2>Default</h2><a href="/new">New</a><button>Delete</button>')
    const ids = ctx.scan.elements.filter(isPomEligible).map((e) => e.id)
    const r = pom(ctx, ids, { propertyNames: { [ids[2]!]: 'class', [ids[1]!]: 'my  link!' } })
    expect(r.properties.map((p) => p.name)).toEqual(['defaultHeading', 'myLink', 'classElement'])
    await execute(r.code, 'LoginPage', 'typescript')
  })
})

describe('locator selection', () => {
  it('uses validated locators that match the scanned element', () => {
    const ctx = prepare()
    const r = pom(ctx, ctx.allEligible)
    for (const p of r.properties) {
      expect(p.validated).toBe(true)
      expect(ctx.validations.get(p.locator.id)!.status).toBe('valid')
    }
  })

  it('skips the recommended locator when live validation shows it matches several elements', () => {
    const ctx = prepare()
    const publish = ctx.id((e) => e.attributes.id === 'publish')
    // The engine recommends the role locator: no other scanned element has the identical expression...
    const recommended = ctx.locators.get(publish)!.locators.find((l) => l.isRecommended)!
    expect(recommended.expression).toBe(`page.getByRole('button', { name: 'Publish' })`)
    // ...but Playwright's substring matching also hits "Publish later", which only validation reveals.
    expect(ctx.validations.get(recommended.id)!.status).toBe('multiple')
    expect(pom(ctx, [publish]).properties[0]!.locator.expression).toBe(`page.locator('#publish')`)
  })

  it('excludes elements without validation, with a reason, unless unvalidated locators are allowed', async () => {
    const ctx = prepare(PAGE, { validate: false })
    const r = pom(ctx, ctx.allEligible)
    expect(r.properties).toEqual([])
    expect(r.excluded).toHaveLength(ctx.allEligible.length)
    expect(r.excluded[0]!.reason).toMatch(/Not validated yet/)

    const allowed = pom(ctx, ctx.allEligible, { allowUnvalidated: true })
    expect(allowed.properties.length).toBe(ctx.allEligible.length)
    expect(allowed.properties.every((p) => !p.validated)).toBe(true)
    expect(allowed.code).toContain('// Unvalidated locator: confirm it before relying on it.')
    expect(allowed.code).toContain('// 0 of 11 locators validated')
    await execute(allowed.code, 'LoginPage', 'typescript')
  })

  it('never uses stale, mismatched or multi-match locators, even when unvalidated ones are allowed', () => {
    const ctx = prepare()
    const email = ctx.id((e) => e.attributes.id === 'email')
    for (const status of ['stale', 'mismatch', 'multiple', 'not-found', 'invalid'] as const) {
      const bad = (l: GeneratedLocator) => ({ ...ctx.validationOf(l)!, status })
      const r = generatePom({ scan: ctx.scan, elementIds: [email], locators: ctx.locators, validationOf: bad, options: { ...OPTIONS, allowUnvalidated: true } })
      expect(r.properties, status).toEqual([])
      expect(r.excluded[0]!.reason.length).toBeGreaterThan(10)
    }
  })
})

describe('methods', () => {
  it('generates goto() without query or fragment, and login() from the form fields and its submit button', async () => {
    const ctx = prepare()
    const r = pom(ctx, ctx.allEligible)
    expect(r.methods).toEqual(['goto', 'login'])
    expect(r.code).toContain('  async login(email: string, password: string, rememberMe: boolean): Promise<void> {')
    const { calls, instance } = await execute(r.code, 'LoginPage', 'typescript')
    calls.length = 0
    await (instance.goto as () => Promise<void>)()
    await (instance.login as (...a: unknown[]) => Promise<void>)('a@b.c', 'pw', true)
    expect(calls[0]).toBe('goto("https://shop.example.test/account/login")')
    expect(calls.slice(1)).toEqual([
      expect.stringMatching(/\.fill\("a@b\.c"\)$/),
      expect.stringMatching(/\.fill\("pw"\)$/),
      expect.stringMatching(/\.setChecked\(true\)$/),
      expect.stringMatching(/Log in.*\.click\(\)$/),
    ])
  })

  it('JavaScript methods carry JSDoc parameter types', () => {
    const ctx = prepare()
    const r = pom(ctx, ctx.allEligible, { language: 'javascript' })
    expect(r.code).toContain('   * @param {boolean} rememberMe')
    expect(r.code).toContain('  async login(email, password, rememberMe) {')
  })

  it('no methods when disabled, and no form method without a single submit button', () => {
    const ctx = prepare()
    expect(pom(ctx, ctx.allEligible, { includeMethods: false }).methods).toEqual([])
    // Without the submit button the form workflow is not supported by the selection.
    const noSubmit = ctx.allEligible.filter((id) => ctx.scan.elements.find((e) => e.id === id)!.accessibleName !== 'Log in')
    expect(pom(ctx, noSubmit).methods).toEqual(['goto'])
  })

  it('login() for fields outside a <form> when one clearly named action button exists', async () => {
    const formless = `
      <button aria-label="open menu">☰</button>
      <div id="form">
        <label for="u">Username</label><input id="u" name="username">
        <label for="p">Password</label><input id="p" name="password" type="password">
        <button id="submit">Submit</button>
      </div>`
    const ctx = prepare(formless)
    const r = pom(ctx, ctx.scan.elements.filter(isPomEligible).map((e) => e.id))
    expect(r.code).toContain('async login(username: string, password: string): Promise<void> {')
    const { calls, instance } = await execute(r.code, 'LoginPage', 'typescript')
    calls.length = 0
    await (instance.login as (...a: unknown[]) => Promise<void>)('u1', 'p1')
    expect(calls.at(-1)).toMatch(/Submit.*\.click\(\)$/) // not "open menu"

    // Two candidate actions: ambiguous, so no method is guessed.
    const two = prepare(`${formless}<button>Continue</button>`)
    expect(pom(two, two.scan.elements.filter(isPomEligible).map((e) => e.id)).methods).toEqual(['goto'])
  })

  it('search() for a single search field form', () => {
    const ctx = prepare('<form role="search"><input type="search" name="q" aria-label="Search"><button>Go</button></form>')
    const r = pom(ctx, ctx.scan.elements.filter(isPomEligible).map((e) => e.id))
    expect(r.methods).toContain('search')
    expect(r.code).toContain('async search(query: string)')
  })
})
