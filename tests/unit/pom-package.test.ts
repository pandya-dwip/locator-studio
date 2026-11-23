import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32 as nodeCrc32 } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { transformWithOxc } from 'vite'
import { generateLocators } from '../../src/core/locator-engine'
import { scanDocument } from '../../src/core/scanner'
import { validateLocators } from '../../src/core/validator'
import {
  createZip,
  generatePackage,
  isPomEligible,
  scenarioIssues,
  type GeneratedPackage,
  type PomOptions,
} from '../../src/generators/playwright'
import { findNoise } from '../../src/shared/relevance'
import type { GeneratedLocator, LocatorValidationResult, PageTestData, ScanResult, TestScenario } from '../../src/shared/types'

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, left: 0, width: 100, height: 20, right: 100, bottom: 20, toJSON() {} } as DOMRect)
})
afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

// Shaped like the Practice Test Automation login page: fields in a <div>, a hidden error message.
const LOGIN = `
  <header><nav><a href="/">Home</a><a href="/practice/">Practice</a></nav></header>
  <h2>Test login</h2>
  <section id="login"><div id="form">
    <div><label for="username">Username</label><input type="text" name="username" id="username"></div>
    <div><label for="password">Password</label><input type="password" name="password" id="password"></div>
    <button id="submit" class="btn">Submit</button>
    <div id="error" class="show" style="display:none">Your username is invalid!</div>
  </div></section>`

const OPTIONS: PomOptions = { language: 'typescript', moduleFormat: 'commonjs', className: 'TestLoginPage', includeMethods: true, allowUnvalidated: false }

function setup(html = LOGIN, { validate = true } = {}) {
  document.body.innerHTML = html
  const { result, elements } = scanDocument(document)
  const scan: ScanResult = { ...result, url: 'https://practice.example.test/practice-test-login/?ref=x', title: 'Test Login | Practice Test Automation' }
  const locators = generateLocators(scan.elements)
  const validations = new Map<string, LocatorValidationResult>()
  if (validate) {
    const items = [...locators.values()].flatMap((r) => r.locators.map((l) => ({ locatorId: l.id, elementId: r.elementId, expression: l.expression, query: l.query })))
    for (const v of validateLocators(document, items, (id) => elements.get(id))) validations.set(v.locatorId, v)
  }
  const noise = findNoise(scan.elements)
  const eligible = scan.elements.filter((e) => isPomEligible(e) && !noise.has(e.id)).map((e) => e.id)
  return { scan, locators, validations, eligible }
}

function build(ctx = setup(), options: Partial<PomOptions> = {}, testData: PageTestData = {}, validationOf?: (l: GeneratedLocator) => LocatorValidationResult | undefined): GeneratedPackage {
  return generatePackage({
    scan: ctx.scan,
    elementIds: ctx.eligible,
    locators: ctx.locators,
    validationOf: validationOf ?? ((l) => ctx.validations.get(l.id)),
    options: { ...OPTIONS, ...options },
    testData,
    generatedAt: new Date('2026-01-02T00:00:00Z'),
  })
}

const file = (pkg: GeneratedPackage, role: 'page' | 'data' | 'spec') => pkg.files.find((f) => f.role === role)!

const configured = (over: Partial<TestScenario> = {}): TestScenario => ({
  id: 's1',
  name: 'Invalid username shows an error',
  values: { username: 'nobody', password: 'wrong' },
  expected: 'failure',
  expectedText: 'Your username is invalid!',
  ...over,
})

describe('package structure', () => {
  it('generates the three files together in one folder, with consistent names', () => {
    const pkg = build()
    expect(pkg.blocked).toBeUndefined()
    expect(pkg.folder).toBe('TestLogin')
    expect(pkg.files.map((f) => f.path)).toEqual(['TestLogin/TestLoginPage.ts', 'TestLogin/TestLoginTestData.ts', 'TestLogin/TestLogin.spec.ts'])
    const spec = file(pkg, 'spec').content
    expect(spec).toContain("import { test, expect } from '@playwright/test';")
    expect(spec).toContain("import { TestLoginPage } from './TestLoginPage';")
    expect(spec).toContain("import { testLoginPageInfo, loginTestData, type LoginTestCase } from './TestLoginTestData';")
  })

  it('page class: real locators, URL without query, goto, login(), message locator, expectLoaded()', () => {
    const page = file(build(), 'page').content
    expect(page).toContain("static readonly url = 'https://practice.example.test/practice-test-login/';")
    expect(page).toContain('readonly usernameInput: Locator;')
    expect(page).toContain('readonly passwordInput: Locator;')
    expect(page).toContain('readonly submitButton: Locator;')
    expect(page).toContain('readonly errorMessage: Locator;')
    expect(page).toContain("this.errorMessage = page.locator('#error');")
    expect(page).toContain('async login(username: string, password: string): Promise<void> {')
    expect(page).toContain('await this.page.goto(TestLoginPage.url);')
    expect(page).toContain('async expectLoaded(): Promise<void> {')
    expect(page).not.toContain('expect(this.errorMessage).toBeVisible') // hidden when scanned: not a load check
  })

  it('test data: typed cases; suggestions use placeholders, never invented credentials', () => {
    const pkg = build()
    const data = file(pkg, 'data').content
    expect(data).toContain('export interface LoginTestCase {')
    expect(data).toContain('export const loginTestData: LoginTestCase[] = [')
    expect(data).toContain("username: 'YOUR_VALID_USERNAME',")
    expect(data).toContain("password: 'YOUR_VALID_PASSWORD',")
    for (const name of ['Valid credentials', 'Invalid credentials', 'Invalid username', 'Invalid password', 'Empty username', 'Empty password']) {
      expect(data).toContain(`name: '${name}',`)
    }
    expect(pkg.scenarios[0]!.suggested).toBe(true)
  })
})

describe('generated TypeScript compiles together', () => {
  it('passes strict tsc (no unused or undefined names, imports resolve) against Playwright types', () => {
    const pkg = build(setup(), {}, { login: [configured(), configured({ id: 's2', name: 'Valid', values: { username: 'u', password: 'p' }, expected: 'success', expectedUrl: '/logged-in' })] })
    const dir = mkdtempSync(join(tmpdir(), 'ls-pom-'))
    try {
      for (const f of pkg.files) {
        mkdirSync(join(dir, pkg.folder), { recursive: true })
        writeFileSync(join(dir, f.path), f.content)
      }
      mkdirSync(join(dir, 'node_modules', '@playwright', 'test'), { recursive: true })
      writeFileSync(join(dir, 'node_modules', '@playwright', 'test', 'package.json'), JSON.stringify({ name: '@playwright/test', types: 'index.d.ts' }))
      writeFileSync(join(dir, 'node_modules', '@playwright', 'test', 'index.d.ts'), PLAYWRIGHT_STUB)
      writeFileSync(
        join(dir, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            strict: true, noUnusedLocals: true, noUnusedParameters: true, noEmit: true, target: 'ES2022',
            module: 'ESNext', moduleResolution: 'bundler', verbatimModuleSyntax: true, types: [], lib: ['ES2022'],
          },
          include: [`${pkg.folder}/*.ts`],
        }),
      )
      const tsc = join(process.cwd(), 'node_modules', 'typescript', 'bin', 'tsc')
      let output = ''
      try {
        execFileSync(process.execPath, [tsc, '-p', dir], { encoding: 'utf8' })
      } catch (err) {
        output = String((err as { stdout?: string }).stdout ?? err)
      }
      expect(output).toBe('')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 30_000)
})

// Minimal type surface of @playwright/test used by generated code.
const PLAYWRIGHT_STUB = `
export interface Locator {
  fill(value: string): Promise<void>; click(): Promise<void>; check(): Promise<void>;
  setChecked(checked: boolean): Promise<void>; selectOption(value: string): Promise<string[]>; first(): Locator;
}
type Role = 'button' | 'link' | 'textbox' | 'heading' | 'checkbox' | 'radio' | 'combobox' | 'img' | 'navigation' | 'main' | 'alert' | 'status' | 'searchbox' | 'listitem' | 'cell'
export interface Page {
  goto(url: string): Promise<unknown>;
  getByRole(role: Role, options?: { name?: string | RegExp; exact?: boolean; level?: number }): Locator;
  getByLabel(text: string): Locator; getByPlaceholder(text: string): Locator; getByText(text: string): Locator;
  getByTestId(id: string): Locator; getByAltText(text: string): Locator; getByTitle(text: string): Locator; locator(selector: string): Locator;
}
interface Matchers {
  toBeVisible(): Promise<void>; toBeHidden(): Promise<void>; toContainText(text: string): Promise<void>;
  toHaveURL(url: string | RegExp): Promise<void>; toHaveTitle(title: string | RegExp): Promise<void>;
}
export declare function expect(target: Locator | Page): Matchers;
type TestBody = (fixtures: { page: Page }) => Promise<void>;
export declare const test: {
  (title: string, body: TestBody): void;
  describe(title: string, body: () => void): void;
  skip(condition: boolean, description?: string): void;
};
`

// ---------------------------------------------------------------------------
// Running the generated suite with a recording fake of @playwright/test.
// ---------------------------------------------------------------------------

interface Run {
  title: string
  skipped?: string
  calls: string[]
}

async function runSuite(pkg: GeneratedPackage): Promise<Run[]> {
  const strip = async (code: string, name: string) =>
    (await transformWithOxc(code, name)).code.replace(/^import .*$/gm, '').replace(/^export /gm, '')
  const page = await strip(file(pkg, 'page').content, 'page.ts')
  const data = await strip(file(pkg, 'data').content, 'data.ts')
  const spec = await strip(file(pkg, 'spec').content, 'spec.ts')

  const runs: Run[] = []
  const tests: { title: string; body: (f: { page: unknown }) => Promise<void> }[] = []
  class Skip extends Error {}
  let current: Run | undefined
  const record = (s: string) => current!.calls.push(s)
  const locator = (desc: string): unknown =>
    new Proxy({}, { get: (_t, m: string) => (m === 'first' ? () => locator(`${desc}.first()`) : async (...a: unknown[]) => record(`${desc}.${m}(${a.map((x) => JSON.stringify(x)).join(', ')})`)) })
  const fakePage = new Proxy({}, { get: (_t, m: string) => (...a: unknown[]) => (m === 'goto' ? (record(`goto(${JSON.stringify(a[0])})`), Promise.resolve()) : locator(`${m}(${a.map((x) => JSON.stringify(x instanceof RegExp ? String(x) : x)).join(', ')})`)) })
  const test = Object.assign((title: string, body: (typeof tests)[number]['body']) => tests.push({ title, body }), {
    describe: (_t: string, body: () => void) => body(),
    skip: (condition: boolean, reason?: string) => {
      if (condition) throw new Skip(reason)
    },
  })
  const expectFn = (target: unknown) =>
    new Proxy({}, { get: (_t, m: string) => async (...a: unknown[]) => record(`expect(${target === fakePage ? 'page' : 'locator'}).${m}(${a.map((x) => (x instanceof RegExp ? String(x) : JSON.stringify(x))).join(', ')})`) })
  // The locator proxy cannot tell its own description to expect(); assertions are matched on order instead.
  new Function('test', 'expect', `${page}\n${data}\n${spec}`)(test, expectFn)

  for (const t of tests) {
    current = { title: t.title, calls: [] }
    try {
      await t.body({ page: fakePage })
    } catch (err) {
      if (err instanceof Skip) current.skipped = err.message
      else throw err
    }
    runs.push(current)
  }
  return runs
}

describe('generated spec behaviour', () => {
  it('runs the page-load test with real assertions', async () => {
    const [load] = await runSuite(build())
    expect(load!.title).toBe('page loads with its key elements')
    expect(load!.calls[0]).toBe('goto("https://practice.example.test/practice-test-login/")')
    expect(load!.calls).toContain('expect(page).toHaveTitle("Test Login | Practice Test Automation")')
    expect(load!.calls.filter((c) => c.endsWith('.toBeVisible()')).length).toBeGreaterThan(0)
  })

  it('skips suggested cases that still have placeholders, with the reason', async () => {
    const runs = await runSuite(build())
    const valid = runs.find((r) => r.title === 'Valid credentials')!
    expect(valid.skipped).toMatch(/Replace the YOUR_ placeholder in username, password/)
    const invalid = runs.find((r) => r.title === 'Invalid credentials')!
    expect(invalid.skipped).toBeUndefined() // runnable now: failure + error message element
    expect(invalid.calls).toContain('getByRole("textbox", {"name":"Username"}).fill("invalid_user")')
  })

  it('reflects edited test data: values, outcome and expectations', async () => {
    const pkg = build(setup(), {}, {
      login: [
        configured(),
        configured({ id: 's2', name: 'Valid login', values: { username: 'my-user', password: 'my-pass' }, expected: 'success', expectedUrl: '/logged-in-successfully/', expectedText: 'Logged In Successfully' }),
        configured({ id: 's3', name: 'Success without expectation', values: { username: 'a', password: 'b' }, expected: 'success', expectedText: undefined }),
      ],
    })
    const runs = await runSuite(pkg)
    const failure = runs.find((r) => r.title === 'Invalid username shows an error')!
    expect(failure.calls).toEqual(expect.arrayContaining([
      'getByRole("textbox", {"name":"Username"}).fill("nobody")',
      'getByLabel("Password").fill("wrong")',
      'expect(locator).toBeVisible()',
      'expect(locator).toContainText("Your username is invalid!")',
    ]))
    const success = runs.find((r) => r.title === 'Valid login')!
    expect(success.calls).toEqual(expect.arrayContaining([
      'getByRole("textbox", {"name":"Username"}).fill("my-user")',
      'expect(page).toHaveURL(/\\/logged-in-successfully\\//)',
      'expect(locator).toBeVisible()',
      'expect(locator).toBeHidden()', // the error message must not be shown
    ]))
    expect(runs.find((r) => r.title === 'Success without expectation')!.skipped).toMatch(/Set expectedUrl or expectedText/)
    // Only the user's scenarios are in the data file.
    expect(file(pkg, 'data').content).not.toContain('YOUR_VALID_USERNAME')
  })
})

describe('validation controls the package', () => {
  it('blocks generation (no files) when nothing is validated, and explains why', () => {
    const pkg = build(setup(LOGIN, { validate: false }))
    expect(pkg.files).toEqual([])
    expect(pkg.blocked).toMatch(/None of the \d+ elements in scope has a usable locator/)
    expect(pkg.blocked).toMatch(/Not validated yet/)
  })

  it('blocks with a clear reason when no elements are in scope', () => {
    const ctx = setup()
    expect(build({ ...ctx, eligible: [] }).blocked).toMatch(/No elements are in scope/)
  })

  it('uses unvalidated locators only when allowed, and marks them', () => {
    const pkg = build(setup(LOGIN, { validate: false }), { allowUnvalidated: true })
    expect(pkg.files).toHaveLength(3)
    expect(file(pkg, 'page').content).toContain('// Unvalidated locator: confirm it before relying on it.')
    expect(pkg.warnings.join(' ')).toMatch(/unvalidated/)
  })

  it('the page class follows the validation results', () => {
    const ctx = setup()
    const normal = file(build(ctx), 'page').content
    expect(normal).toContain("this.usernameInput = page.getByRole('textbox', { name: 'Username' });")
    // If the role locator turns out ambiguous on the live page, the next valid candidate is used.
    const pkg = build(ctx, {}, {}, (l) => {
      const v = ctx.validations.get(l.id)
      return v && l.expression.startsWith("page.getByRole('textbox'") ? { ...v, status: 'multiple', matchCount: 2 } : v
    })
    expect(file(pkg, 'page').content).toContain("this.usernameInput = page.getByLabel('Username');")
  })
})

describe('JavaScript output', () => {
  it('CommonJS requires, ESM imports with .js extensions', () => {
    const cjs = build(setup(), { language: 'javascript' })
    expect(cjs.files.map((f) => f.name)).toEqual(['TestLoginPage.js', 'TestLoginTestData.js', 'TestLogin.spec.js'])
    expect(file(cjs, 'spec').content).toContain("const { TestLoginPage } = require('./TestLoginPage');")
    expect(file(cjs, 'data').content).toContain('module.exports = { testLoginPageInfo, loginTestData };')
    const esm = build(setup(), { language: 'javascript', moduleFormat: 'esm' })
    expect(file(esm, 'spec').content).toContain("import { TestLoginPage } from './TestLoginPage.js';")
    expect(file(esm, 'spec').content).toContain("import { testLoginPageInfo, loginTestData } from './TestLoginTestData.js';")
  })
})

describe('scenario checks', () => {
  it('flags placeholders, missing expectations and invalid radio values', () => {
    const form = build().pom.forms[0]!
    expect(scenarioIssues(configured(), form)).toEqual([])
    expect(scenarioIssues(configured({ values: { username: 'YOUR_VALID_USERNAME', password: 'x' } }), form)[0]).toMatch(/placeholder in username/)
    expect(scenarioIssues(configured({ expected: 'success', expectedText: undefined }), form)[0]).toMatch(/expected URL or expected text/)
  })
})

describe('zip', () => {
  it('stores every file under the folder with correct CRC-32 and contents', () => {
    const pkg = build()
    const zip = createZip(pkg.files.map((f) => ({ path: f.path, content: f.content })))
    const view = new DataView(zip.buffer)
    const decoder = new TextDecoder()
    let at = 0
    const entries: { name: string; content: string }[] = []
    while (view.getUint32(at, true) === 0x04034b50) {
      const crc = view.getUint32(at + 14, true)
      const size = view.getUint32(at + 18, true)
      const nameLength = view.getUint16(at + 26, true)
      const name = decoder.decode(zip.subarray(at + 30, at + 30 + nameLength))
      const data = zip.subarray(at + 30 + nameLength, at + 30 + nameLength + size)
      expect(crc).toBe(nodeCrc32(data))
      entries.push({ name, content: decoder.decode(data) })
      at += 30 + nameLength + size
    }
    expect(entries.map((e) => e.name)).toEqual(pkg.files.map((f) => f.path))
    expect(entries.map((e) => e.content)).toEqual(pkg.files.map((f) => f.content))
    expect(view.getUint32(zip.length - 22, true)).toBe(0x06054b50)
  })
})
