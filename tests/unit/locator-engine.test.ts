import { afterEach, describe, expect, it } from 'vitest'
import { generateLocators, generateLocatorsAsync } from '../../src/core/locator-engine'
import { assessValue, generatedReason, textConcerns } from '../../src/core/locator-engine/utils/stability'
import { scanDocument } from '../../src/core/scanner'
import type { ElementLocatorResult, GeneratedLocator, ScannedElement } from '../../src/shared/types'

// ---------------------------------------------------------------------------
// Harness: scan a fixture with the real scanner, generate locators, and check
// generic invariants against the DOM for every element.
// ---------------------------------------------------------------------------

interface Run {
  elements: ScannedElement[]
  nodes: Map<string, Element>
  locators: Map<string, ElementLocatorResult>
}

function run(html: string, testIdAttribute = 'data-testid'): Run {
  document.body.innerHTML = html
  const { result, elements: nodes } = scanDocument(document)
  const locators = generateLocators(result.elements, { testIdAttribute })
  checkInvariants({ elements: result.elements, nodes, locators }, testIdAttribute)
  return { elements: result.elements, nodes, locators }
}

/** Locator result for the element marked data-k="key". */
function forKey(r: Run, key: string): ElementLocatorResult {
  const el = r.elements.find((e) => e.attributes['data-k'] === key)
  if (!el) throw new Error(`no scanned element with data-k=${key}`)
  return r.locators.get(el.id)!
}

const expressions = (res: ElementLocatorResult) => res.locators.map((l) => l.expression)
const recommended = (res: ElementLocatorResult) => res.locators.find((l) => l.isRecommended)
const withExpression = (res: ElementLocatorResult, expression: string) => {
  const found = res.locators.find((l) => l.expression === expression)
  expect(found, `${expression} in ${JSON.stringify(expressions(res))}`).toBeDefined()
  return found!
}

interface Call {
  method: string
  args: unknown[]
}

/** Evaluates an expression against a recording fake `page`; throws on invalid syntax. */
function evaluate(expression: string): Call {
  let call: Call | undefined
  let calls = 0
  const page = new Proxy(
    {},
    {
      get: (_target, method: string) =>
        (...args: unknown[]) => {
          calls++
          call = { method, args }
          return {}
        },
    },
  )
  new Function('page', `"use strict"; return ${expression}`)(page)
  if (calls !== 1 || !call) throw new Error(`expected exactly one page call in ${expression}`)
  return call
}

const ALLOWED_OPTIONS: Record<string, string> = { name: 'string', level: 'number', exact: 'boolean' }

/** The page call a query corresponds to, for cross-checking against the expression. */
function queryArgs(q: GeneratedLocator['query']): Call {
  const method = { role: 'getByRole', label: 'getByLabel', placeholder: 'getByPlaceholder', text: 'getByText', alttext: 'getByAltText', title: 'getByTitle', testid: 'getByTestId', css: 'locator', xpath: 'locator' }[q.kind]
  if (q.kind === 'role') {
    const opts = Object.fromEntries(Object.entries({ name: q.name, level: q.level, exact: q.exact }).filter(([, v]) => v !== undefined))
    return { method, args: Object.keys(opts).length ? [q.role, opts] : [q.role] }
  }
  if (q.kind === 'testid') return { method, args: [q.value] }
  if ('selector' in q) return { method, args: [q.selector] }
  return { method, args: [q.text] }
}
const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()

function matchesSelector(selector: string, node: Element): boolean {
  if (selector.startsWith('//')) {
    const snapshot = document.evaluate(selector, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null)
    return Array.from({ length: snapshot.snapshotLength }, (_, i) => snapshot.snapshotItem(i)).includes(node)
  }
  return [...document.querySelectorAll(selector)].includes(node)
}

function checkInvariants(r: Run, testIdAttribute: string) {
  for (const el of r.elements) {
    const node = r.nodes.get(el.id)!
    const res = r.locators.get(el.id)!
    expect(res.elementId).toBe(el.id)
    expect(new Set(res.locators.map((l) => l.id)).size).toBe(res.locators.length)
    expect(res.locators.filter((l) => l.isRecommended).length).toBeLessThanOrEqual(1)

    for (const l of res.locators) {
      expect('validation' in l, 'generation never reports validation').toBe(false)
      expect(queryArgs(l.query), `query mirrors ${l.expression}`).toEqual(evaluate(l.expression))
      expect(l.stabilityReasons.length).toBeGreaterThan(0)
      expect(l.sourceAttributes.length).toBeGreaterThan(0)

      const { method, args } = evaluate(l.expression)
      expect(typeof args[0]).toBe('string')
      if (args[1] !== undefined) {
        for (const [k, v] of Object.entries(args[1] as object)) expect(typeof v).toBe(ALLOWED_OPTIONS[k])
      }
      const value = args[0] as string
      const opts = (args[1] ?? {}) as { name?: string }
      switch (method) {
        case 'locator':
          // Shadow-DOM elements are only reachable by Playwright's piercing CSS, not by querySelector.
          if (!el.inShadowRoot) expect(matchesSelector(value, node), `${l.expression} selects its element`).toBe(true)
          break
        case 'getByTestId':
          expect(node.getAttribute(testIdAttribute)).toBe(value)
          break
        case 'getByRole':
          expect(value).toBe(el.role)
          if (opts.name !== undefined) expect(opts.name).toBe(el.accessibleName)
          break
        case 'getByLabel':
          expect(['label', 'aria-label', 'aria-labelledby']).toContain(el.accessibleNameSource)
          expect(value).toBe(el.accessibleName)
          break
        case 'getByPlaceholder':
          expect(node.getAttribute('placeholder')).toBe(value)
          break
        case 'getByAltText':
          expect(node.getAttribute('alt')).toBe(value)
          break
        case 'getByTitle':
          expect(node.getAttribute('title')).toBe(value)
          break
        case 'getByText':
          expect(norm(node.textContent)).toContain(value)
          break
        default:
          throw new Error(`unexpected method ${method}`)
      }
    }
  }
}

afterEach(() => {
  document.body.innerHTML = ''
})

// ---------------------------------------------------------------------------
// A realistic page used by most tests.
// ---------------------------------------------------------------------------
const LOGIN_PAGE = `
  <header>
    <nav aria-label="Main" data-k="nav">
      <a href="/" class="nav-link brand">Acme</a>
      <a href="/products" class="nav-link">Products</a>
    </nav>
  </header>
  <main data-k="main">
    <h1 data-k="h1">Sign in</h1>
    <form id="login-form" action="/session" method="post" data-k="form">
      <label for="email">Email address</label>
      <input data-k="email" id="email" name="email" type="email" placeholder="you@example.com" data-testid="email-input">
      <label for="password">Password</label>
      <input data-k="password" id="password" name="password" type="password" data-test="password-field">
      <label><input data-k="remember" type="checkbox" name="remember" data-cy="remember-me"> Remember me</label>
      <input data-k="search" type="text" placeholder="Search products" class="sc-bdVaJa css-1x2y3z mt-4 search-input">
      <button data-k="login" type="submit" class="btn btn-primary" id="login-button">Log in</button>
      <a data-k="forgot" href="/forgot">Forgot password?</a>
    </form>
    <img data-k="logo" src="/logo.png" alt="Company logo">
    <img data-k="photo" src="/x.png" alt="photo.png">
    <button data-k="close" title="Close dialog" class="icon-button">×</button>
    <p data-k="quote">Welcome back, it's "great" to see you</p>
    <span data-k="unicode">Café — naïve façade 東京</span>
    <button data-k="special">Save &amp; continue → 100% &lt;now&gt;</button>
    <article data-k="card" class="card product-card featured shadow-lg is-active"><h2>Widget</h2></article>
    <div data-k="generated" id="ember1234" class="Button_primary__3xK9a">Generated</div>
  </main>`

describe('strategies', () => {
  it('1. button with an accessible name gets role, id, text, class and XPath candidates', () => {
    const res = forKey(run(LOGIN_PAGE), 'login')
    expect(recommended(res)?.expression).toBe(`page.getByRole('button', { name: 'Log in' })`)
    withExpression(res, `page.locator('#login-button')`)
    withExpression(res, `page.getByText('Log in')`)
    withExpression(res, `page.locator('button.btn.btn-primary')`)
    withExpression(res, `page.locator('//button[@id="login-button"]')`)
  })

  it('2. link with an accessible name', () => {
    const res = forKey(run(LOGIN_PAGE), 'forgot')
    expect(recommended(res)?.expression).toBe(`page.getByRole('link', { name: 'Forgot password?' })`)
    expect(withExpression(res, `page.locator('a[href="/forgot"]')`).stability).toBe('moderate')
  })

  it('3. checkbox with an associated (wrapping) label', () => {
    const res = forKey(run(LOGIN_PAGE), 'remember')
    withExpression(res, `page.getByRole('checkbox', { name: 'Remember me' })`)
    expect(withExpression(res, `page.getByLabel('Remember me')`).stability).toBe('stable')
  })

  it('4. input with only a placeholder', () => {
    const res = forKey(run(LOGIN_PAGE), 'search')
    const placeholder = withExpression(res, `page.getByPlaceholder('Search products')`)
    expect(placeholder.stability).toBe('moderate')
    // The role name comes from the placeholder, so it is not treated as a label.
    expect(withExpression(res, `page.getByRole('textbox', { name: 'Search products' })`).stability).toBe('moderate')
    expect(res.locators.some((l) => l.strategy === 'label')).toBe(false)
  })

  it('5. input with data-testid uses getByTestId and is recommended', () => {
    const res = forKey(run(LOGIN_PAGE), 'email')
    const testId = withExpression(res, `page.getByTestId('email-input')`)
    expect(testId).toMatchObject({ strategy: 'testid', stability: 'stable', isRecommended: true, sourceAttributes: ['data-testid'] })
    expect(res.locators[0]).toBe(testId)
  })

  it('6. data-test is written as CSS (getByTestId reads data-testid by default)', () => {
    const res = forKey(run(LOGIN_PAGE), 'password')
    const l = withExpression(res, `page.locator('[data-test="password-field"]')`)
    expect(l).toMatchObject({ strategy: 'testid', sourceAttributes: ['data-test'], isRecommended: true })
    expect(l.notes.join(' ')).toMatch(/getByTestId\(\) reads data-testid/)
    expect(expressions(res).some((e) => e.includes('getByTestId'))).toBe(false)
    withExpression(res, `page.getByLabel('Password')`)
  })

  it('7. data-cy becomes getByTestId only when configured as the test id attribute', () => {
    expect(expressions(forKey(run(LOGIN_PAGE), 'remember'))).toContain(`page.locator('[data-cy="remember-me"]')`)
    const configured = forKey(run(LOGIN_PAGE, 'data-cy'), 'remember')
    expect(recommended(configured)?.expression).toBe(`page.getByTestId('remember-me')`)
  })

  it('8. image alt text, ignoring file names', () => {
    const r = run(LOGIN_PAGE)
    const logo = forKey(r, 'logo')
    withExpression(logo, `page.getByAltText('Company logo')`)
    withExpression(logo, `page.getByRole('img', { name: 'Company logo' })`)
    expect(forKey(r, 'photo').locators.some((l) => l.strategy === 'alttext')).toBe(false)
  })

  it('9. title beats a symbol-only accessible name', () => {
    const res = forKey(run(LOGIN_PAGE), 'close')
    const title = withExpression(res, `page.getByTitle('Close dialog')`)
    const role = withExpression(res, `page.getByRole('button', { name: '×' })`)
    expect(role.stability).toBe('moderate')
    expect(title).toMatchObject({ stability: 'stable', isRecommended: true })
  })

  it('10. element with a unique id', () => {
    const l = withExpression(forKey(run(LOGIN_PAGE), 'login'), `page.locator('#login-button')`)
    expect(l).toMatchObject({ strategy: 'css', stability: 'stable', sharedWith: 0, sourceAttributes: ['id'] })
  })

  it('11. duplicate ids are marked as shared and never recommended', () => {
    const r = run('<button data-k="a" id="dup">Alpha</button><button data-k="b" id="dup">Beta</button>')
    for (const key of ['a', 'b']) {
      const dup = withExpression(forKey(r, key), `page.locator('#dup')`)
      expect(dup).toMatchObject({ sharedWith: 1, isRecommended: false })
    }
    expect(recommended(forKey(r, 'a'))?.expression).toBe(`page.getByRole('button', { name: 'Alpha' })`)
  })

  it('12. multiple classes: at most two meaningful classes, no state or utility classes', () => {
    const res = forKey(run(LOGIN_PAGE), 'card')
    expect(res.locators.filter((l) => l.strategy === 'css').map((l) => l.displayValue)).toEqual(['article.card.product-card'])
  })

  it('13. dynamic-looking classes and ids are skipped or marked unstable', () => {
    const r = run(LOGIN_PAGE)
    expect(withExpression(forKey(r, 'search'), `page.locator('input.search-input')`).displayValue).toBe('input.search-input')
    const generated = forKey(r, 'generated')
    const id = withExpression(generated, `page.locator('#ember1234')`)
    expect(id.stability).toBe('unstable')
    expect(id.stabilityReasons.join(' ')).toMatch(/framework|number/)
    expect(expressions(generated).some((e) => e.includes('Button_primary'))).toBe(false)
    expect(recommended(generated)?.strategy).toBe('text')
  })

  it('14. text containing quotes is escaped for JavaScript and XPath', () => {
    const res = forKey(run(LOGIN_PAGE), 'quote')
    const text = res.locators.find((l) => l.strategy === 'text')!
    expect(evaluate(text.expression).args[0]).toBe(`Welcome back, it's "great" to see you`)
    expect(res.locators.find((l) => l.strategy === 'xpath')!.expression).toContain('concat(')
  })

  it('15. Unicode text is preserved', () => {
    const res = forKey(run(LOGIN_PAGE), 'unicode')
    withExpression(res, `page.getByText('Café — naïve façade 東京')`)
  })

  it('16. empty or whitespace-only text produces no text locator', () => {
    const r = run('<button data-k="b" aria-label="Menu"> </button><p data-k="p" title="Note">   </p>')
    expect(forKey(r, 'b').locators.some((l) => l.strategy === 'text')).toBe(false)
    expect(forKey(r, 'p').locators.some((l) => l.strategy === 'text')).toBe(false)
  })

  it('17. special characters in text and ids', () => {
    const r = run(`${LOGIN_PAGE}<input data-k="weird" id="user.name:first" name="a[b]">`)
    const special = forKey(r, 'special')
    expect(evaluate(special.locators.find((l) => l.strategy === 'text')!.expression).args[0]).toBe('Save & continue → 100% <now>')
    const weird = forKey(r, 'weird')
    withExpression(weird, String.raw`page.locator('#user\\.name\\:first')`)
    withExpression(weird, `page.locator('input[name="a[b]"]')`)
  })

  it('18. element with no usable attributes, name or text gets no candidates', () => {
    const res = forKey(run('<button data-k="empty"></button>'), 'empty')
    expect(res.locators).toEqual([])
    expect(res.recommendedLocatorId).toBeUndefined()
    expect(res.noRecommendationReason).toMatch(/Not enough identifying information/)
  })

  it('19. an element supporting many strategies gets all of them', () => {
    const res = forKey(run(LOGIN_PAGE), 'email')
    expect(new Set(res.locators.map((l) => l.strategy))).toEqual(new Set(['testid', 'role', 'label', 'placeholder', 'css', 'xpath']))
    withExpression(res, `page.getByLabel('Email address')`)
    withExpression(res, `page.locator('input[name="email"]')`)
  })

  it('20. no recommendation when every candidate is shared or unstable', () => {
    const r = run(`
      <ul><li data-k="one">Duplicate</li><li data-k="two">Duplicate</li></ul>
      <button data-k="react" id=":r1:"></button>`)
    const dup = forKey(r, 'one')
    expect(dup.locators.length).toBeGreaterThan(0)
    expect(dup.locators.every((l) => l.sharedWith === 1)).toBe(true)
    expect(dup.recommendedLocatorId).toBeUndefined()
    expect(dup.noRecommendationReason).toMatch(/also generated for other scanned elements/)

    const react = forKey(r, 'react')
    expect(react.locators.every((l) => l.stability === 'unstable')).toBe(true)
    expect(react.noRecommendationReason).toMatch(/Only unstable candidates/)
  })
})

describe('roles', () => {
  it('adds heading levels, uses landmarks without names, and skips unnamed non-landmarks', () => {
    const r = run(LOGIN_PAGE)
    expect(recommended(forKey(r, 'h1'))?.expression).toBe(`page.getByRole('heading', { name: 'Sign in', level: 1 })`)
    expect(expressions(forKey(r, 'main'))).toContain(`page.getByRole('main')`)
    expect(expressions(forKey(r, 'nav'))).toContain(`page.getByRole('navigation', { name: 'Main' })`)
    // Unnamed form: no role in Playwright, so no getByRole('form').
    expect(expressions(forKey(r, 'form')).some((e) => e.includes('getByRole'))).toBe(false)
  })

  it('never invents roles for presentational or onclick-only elements', () => {
    const r = run('<img data-k="deco" src="/d.png" alt=""><div data-k="click" onclick="go()">Go somewhere</div>')
    expect(forKey(r, 'deco').locators.some((l) => l.strategy === 'role')).toBe(false)
    expect(forKey(r, 'click').locators.some((l) => l.strategy === 'role')).toBe(false)
    expect(expressions(forKey(r, 'click'))).toContain(`page.getByText('Go somewhere')`)
  })

  it('notes that hidden elements are only matched by getByRole while rendered', () => {
    const res = forKey(run('<button data-k="h" style="display:none">Hidden action</button>'), 'h')
    expect(res.locators.find((l) => l.strategy === 'role')!.notes.join(' ')).toMatch(/includeHidden/)
  })

  it('skips XPath inside shadow roots but keeps CSS and role locators', () => {
    const host = document.createElement('my-card')
    host.attachShadow({ mode: 'open' }).innerHTML = '<button id="shadow-btn" data-k="s">Shadow</button>'
    document.body.append(host)
    const { result } = scanDocument(document)
    const res = generateLocators(result.elements).get(result.elements.find((e) => e.attributes['data-k'] === 's')!.id)!
    expect(res.locators.some((l) => l.strategy === 'xpath')).toBe(false)
    expect(expressions(res)).toEqual(expect.arrayContaining([`page.getByRole('button', { name: 'Shadow' })`, `page.locator('#shadow-btn')`]))
  })
})

describe('stability', () => {
  it('recognises generated values', () => {
    for (const v of [':r1:', '«r2»', 'ember1234', 'css-1x2y3z', 'Button_primary__3xK9a', 'a8f3k2', 'sc-bdVaJa', 'f47ac10b-58cc-4372-a567-0e02b2c3d479']) {
      expect(generatedReason(v), v).not.toBeNull()
    }
    for (const v of ['login-button', 'MuiButton-root', 'email', 'step2', 'item42', 'nav-link', 'iPhone']) {
      expect(generatedReason(v), v).toBeNull()
    }
  })

  it('separates hand-written, numbered and generated values', () => {
    expect(assessValue('stable', 'id', 'login').level).toBe('stable')
    expect(assessValue('stable', 'id', 'item42').level).toBe('moderate')
    expect(assessValue('stable', 'id', ':r5:').level).toBe('unstable')
  })

  it('flags volatile text', () => {
    expect(textConcerns('Log in')).toEqual([])
    expect(textConcerns('3 items in cart').join(' ')).toMatch(/numbers/)
    expect(textConcerns('×').join(' ')).toMatch(/no letters/)
    expect(textConcerns('a'.repeat(41)).join(' ')).toMatch(/Long text/)
  })

  it('downgrades text locators with numbers to unstable', () => {
    const res = forKey(run('<p data-k="p">You have 3 new messages</p>'), 'p')
    expect(res.locators.find((l) => l.strategy === 'text')!.stability).toBe('unstable')
  })
})

describe('ordering and recommendation', () => {
  it('puts the recommendation first, then sorts by stability and strategy preference', () => {
    const r = run(LOGIN_PAGE)
    const order = { stable: 0, moderate: 1, unstable: 2, unknown: 3 }
    for (const res of r.locators.values()) {
      const rest = res.recommendedLocatorId ? res.locators.slice(1) : res.locators
      if (res.recommendedLocatorId) expect(res.locators[0]!.id).toBe(res.recommendedLocatorId)
      for (let i = 1; i < rest.length; i++) expect(order[rest[i - 1]!.stability]).toBeLessThanOrEqual(order[rest[i]!.stability])
    }
  })

  it('prefers test ids, then role, label, placeholder, alt text, title, CSS, text and XPath', () => {
    const r = run(`
      <input data-k="all" data-testid="t" id="i" name="n" aria-label="Field" placeholder="Type" title="Tip">
      <input data-k="nolabel" id="postcode" name="zip" placeholder="Type here">`)
    const all = forKey(r, 'all')
    expect(all.locators.map((l) => l.strategy)).toEqual(['testid', 'role', 'label', 'title', 'css', 'css', 'css', 'xpath', 'placeholder'])
    const nolabel = forKey(r, 'nolabel')
    // Stable CSS (id, name) outranks the moderate placeholder-derived name.
    expect(recommended(nolabel)?.expression).toBe(`page.locator('#postcode')`)
  })

  it('never recommends unstable or shared candidates, and keeps equally good alternatives', () => {
    const r = run(LOGIN_PAGE)
    for (const res of r.locators.values()) {
      const rec = recommended(res)
      if (rec) expect(rec.sharedWith === 0 && rec.stability !== 'unstable').toBe(true)
    }
    const email = forKey(r, 'email')
    expect(email.locators.filter((l) => l.stability === 'stable').length).toBeGreaterThan(1)
  })
})

describe('batch generation', () => {
  it('isolates a failing element and keeps the rest', () => {
    document.body.innerHTML = LOGIN_PAGE
    const { result } = scanDocument(document)
    const broken = {
      ...result.elements[0]!,
      id: 'broken',
      get attributes(): Record<string, string> {
        throw new Error('boom')
      },
    } as ScannedElement
    const out = generateLocators([...result.elements, broken])
    expect(out.get('broken')).toMatchObject({ error: 'boom', locators: [], noRecommendationReason: expect.stringMatching(/failed/) })
    expect(out.size).toBe(result.elements.length + 1)
    const clean = generateLocators(result.elements)
    for (const el of result.elements) expect(out.get(el.id)).toEqual(clean.get(el.id))
  })

  it('does not mutate the scan result', () => {
    document.body.innerHTML = LOGIN_PAGE
    const { result } = scanDocument(document)
    const before = JSON.stringify(result.elements)
    generateLocators(result.elements)
    expect(JSON.stringify(result.elements)).toBe(before)
  })

  it('async chunked generation equals sync generation and can be aborted', async () => {
    document.body.innerHTML = LOGIN_PAGE
    const { result } = scanDocument(document)
    const sync = generateLocators(result.elements)
    const async = await generateLocatorsAsync(result.elements, undefined, { chunkSize: 3 })
    expect([...async.entries()]).toEqual([...sync.entries()])

    const controller = new AbortController()
    controller.abort()
    await expect(generateLocatorsAsync(result.elements, undefined, { signal: controller.signal })).rejects.toThrow()
  })

  it('handles a large scan', () => {
    // 700 rows × 6 elements stays under the 5,000-element scan limit.
    const rows = Array.from({ length: 700 }, (_, i) => `<tr><td>Row ${i}</td><td><a href="/r/${i}">Open</a></td><td><button id="edit-${i}">Edit</button></td></tr>`).join('')
    document.body.innerHTML = `<table><tbody>${rows}</tbody></table>`
    const { result } = scanDocument(document)
    const started = performance.now()
    const out = generateLocators(result.elements)
    const ms = performance.now() - started
    expect(out.size).toBe(result.elements.length)
    // "Open" and "Edit" repeat on every row: those candidates are shared and never recommended.
    const edit = [...out.values()].find((r) => r.locators.some((l) => l.expression === `page.getByRole('button', { name: 'Edit' })`))!
    expect(edit.locators.find((l) => l.strategy === 'role')!.sharedWith).toBe(699)
    expect(edit.locators.find((l) => l.isRecommended)?.expression).toMatch(/#edit-\d+/)
    expect(ms).toBeLessThan(5000)
  }, 20_000) // jsdom scanning of ~4,000 elements is slow when suites run in parallel
})

describe('scope', () => {
  it('never reports validation results', () => {
    const r = run(LOGIN_PAGE)
    const all: GeneratedLocator[] = [...r.locators.values()].flatMap((x) => x.locators)
    expect(all.length).toBeGreaterThan(30)
    expect(all.every((l) => !('validation' in l))).toBe(true)
  })
})
