import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateLocators } from '../../src/core/locator-engine'
import { scanDocument } from '../../src/core/scanner'
import { validateLocators } from '../../src/core/validator'
import type { LocatorQuery, LocatorValidationResult, ValidationRequestItem } from '../../src/shared/types'

// jsdom has no layout: give elements a box unless data-zero is set.
beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const zero = this.hasAttribute('data-zero')
    return { x: 0, y: 0, top: 0, left: 0, width: zero ? 0 : 100, height: zero ? 0 : 20, right: zero ? 0 : 100, bottom: zero ? 0 : 20, toJSON() {} } as DOMRect
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

/** Scans the fixture; returns helpers bound to the scan snapshot. */
function scan(html: string) {
  document.body.innerHTML = html
  const { result, elements } = scanDocument(document)
  const idOf = (key: string) => {
    const el = result.elements.find((e) => e.attributes['data-k'] === key)
    if (!el) throw new Error(`no scanned element data-k=${key}`)
    return el.id
  }
  const lookup = (id: string) => elements.get(id)
  const check = (key: string, query: LocatorQuery): LocatorValidationResult =>
    validateLocators(document, [{ locatorId: 'l1', elementId: idOf(key), expression: 'expr', query }], lookup)[0]!
  return { result, elements, idOf, lookup, check }
}

const PAGE = `
  <form>
    <label for="email">Email address</label>
    <input data-k="email" id="email" name="email" type="email" placeholder="Search or email" data-testid="email-input">
    <button data-k="login" id="login" class="btn">Log in</button>
    <button data-k="help" class="btn">Login help</button>
    <button data-k="hidden" style="display:none">Log in</button>
    <button data-k="disabled" id="off" disabled>Disabled action</button>
  </form>
  <p data-k="welcome">Welcome <b>back</b></p>
  <button data-k="wrapped"><span>Wrapped label</span></button>
  <div data-k="other" id="other" title="Other">Other</div>`

describe('CSS and XPath (native selector APIs)', () => {
  it('unique CSS selector matches the scanned element', () => {
    const r = scan(PAGE).check('login', { kind: 'css', selector: '#login' })
    expect(r).toMatchObject({ status: 'valid', matchCount: 1, isUnique: true, matchesOriginalElement: true, isVisible: true, isEnabled: true, approximate: false })
    expect(r.warnings).toEqual([])
  })

  it('duplicate CSS selector reports multiple matches', () => {
    const r = scan(PAGE).check('login', { kind: 'css', selector: 'button.btn' })
    expect(r).toMatchObject({ status: 'multiple', matchCount: 2, isUnique: false, matchesOriginalElement: true })
  })

  it('missing CSS selector reports not-found', () => {
    expect(scan(PAGE).check('login', { kind: 'css', selector: '#nope' })).toMatchObject({ status: 'not-found', matchCount: 0 })
  })

  it('invalid CSS and XPath are reported as invalid, not as errors', () => {
    const s = scan(PAGE)
    expect(s.check('login', { kind: 'css', selector: 'button[' }).status).toBe('invalid')
    expect(s.check('login', { kind: 'xpath', selector: '//button[' }).status).toBe('invalid')
  })

  it('XPath selector', () => {
    expect(scan(PAGE).check('login', { kind: 'xpath', selector: '//button[@id="login"]' })).toMatchObject({ status: 'valid', matchCount: 1 })
  })
})

describe('semantic locators', () => {
  it('role + name uses case-insensitive substring matching like Playwright, and exact narrows it', () => {
    const s = scan(PAGE)
    // "log in" is a substring of "Log in" only; the hidden button is excluded from the accessibility tree.
    expect(s.check('login', { kind: 'role', role: 'button', name: 'log in' })).toMatchObject({ status: 'valid', approximate: true })
    expect(s.check('login', { kind: 'role', role: 'button', name: 'log' })).toMatchObject({ status: 'multiple', matchCount: 2 })
    expect(s.check('login', { kind: 'role', role: 'button', name: 'Log in', exact: true })).toMatchObject({ status: 'valid', matchCount: 1 })
  })

  it('label locator', () => {
    const r = scan(PAGE).check('email', { kind: 'label', text: 'Email address' })
    expect(r).toMatchObject({ status: 'valid', approximate: true })
    expect(r.warnings.join(' ')).toMatch(/approximates Playwright/)
  })

  it('placeholder, title and test id locators (exact attribute semantics)', () => {
    const s = scan(PAGE)
    expect(s.check('email', { kind: 'placeholder', text: 'search' })).toMatchObject({ status: 'valid', approximate: false })
    expect(s.check('other', { kind: 'title', text: 'Other' })).toMatchObject({ status: 'valid' })
    expect(s.check('email', { kind: 'testid', attribute: 'data-testid', value: 'email-input' })).toMatchObject({ status: 'valid', approximate: false })
    expect(s.check('email', { kind: 'testid', attribute: 'data-testid', value: 'email' }).status).toBe('not-found') // exact, not substring
  })

  it('text locator returns the innermost element containing the text', () => {
    const s = scan(PAGE)
    expect(s.check('welcome', { kind: 'text', text: 'welcome back' })).toMatchObject({ status: 'valid', approximate: true })
    // The text lives in the <span>, so getByText resolves to the span, not the button.
    const wrapped = s.check('wrapped', { kind: 'text', text: 'Wrapped label' })
    expect(wrapped).toMatchObject({ status: 'mismatch', matchCount: 1, matchesOriginalElement: false })
    expect(wrapped.message).toMatch(/inside the scanned element/)
  })

  it('never claims exact Playwright equivalence for approximated strategies', () => {
    const s = scan(PAGE)
    for (const q of [
      { kind: 'role', role: 'button', name: 'Log in' },
      { kind: 'label', text: 'Email address' },
      { kind: 'text', text: 'Log in' },
    ] as LocatorQuery[]) {
      const r = s.check('login', q)
      expect(r.approximate).toBe(true)
      expect(r.warnings.some((w) => /Confirm in a Playwright run/.test(w))).toBe(true)
    }
  })
})

describe('element state', () => {
  it('reports hidden and disabled matches without failing them', () => {
    const s = scan(PAGE)
    const hidden = s.check('hidden', { kind: 'css', selector: 'button[style]' })
    expect(hidden).toMatchObject({ status: 'valid', isVisible: false })
    expect(hidden.warnings.join(' ')).toMatch(/not visible/)
    const disabled = s.check('disabled', { kind: 'css', selector: '#off' })
    expect(disabled).toMatchObject({ status: 'valid', isEnabled: false })
  })
})

describe('original-element verification', () => {
  it('a unique match that is a different element is a mismatch, not valid', () => {
    expect(scan(PAGE).check('login', { kind: 'css', selector: '#other' })).toMatchObject({ status: 'mismatch', matchCount: 1, isUnique: true, matchesOriginalElement: false })
  })

  it('removed original element makes results stale', () => {
    const s = scan(PAGE)
    document.getElementById('login')!.remove()
    expect(s.check('login', { kind: 'css', selector: '#login' })).toMatchObject({ status: 'stale', matchCount: 0, matchesOriginalElement: undefined })
  })

  it('replaced (re-rendered) original element is stale even if the locator still finds a look-alike', () => {
    const s = scan(PAGE)
    const old = document.getElementById('login')!
    old.replaceWith(old.cloneNode(true))
    const r = s.check('login', { kind: 'css', selector: '#login' })
    expect(r).toMatchObject({ status: 'stale', matchCount: 1 })
    expect(r.message).toMatch(/now matches 1 element/)
  })

  it('reflects DOM changes after scanning', () => {
    const s = scan(PAGE)
    expect(s.check('login', { kind: 'css', selector: '#login' }).status).toBe('valid')
    document.body.insertAdjacentHTML('beforeend', '<button id="login">Another</button>')
    expect(s.check('login', { kind: 'css', selector: '#login' })).toMatchObject({ status: 'multiple', matchCount: 2 })
  })

  it('unknown element ids (other snapshot) are stale', () => {
    scan(PAGE)
    const [r] = validateLocators(document, [{ locatorId: 'x', elementId: 'el-999', expression: 'e', query: { kind: 'css', selector: '#login' } }], () => undefined)
    expect(r!.status).toBe('stale')
  })
})

describe('shadow DOM', () => {
  it('CSS pierces open shadow roots like Playwright; XPath does not', () => {
    const host = document.createElement('my-card')
    host.attachShadow({ mode: 'open' }).innerHTML = '<button id="shadow-btn">Shadow</button>'
    document.body.append(host)
    const { result, elements } = scanDocument(document)
    const id = result.elements.find((e) => e.attributes.id === 'shadow-btn')!.id
    const run = (query: LocatorQuery) => validateLocators(document, [{ locatorId: 'l', elementId: id, expression: 'e', query }], (x) => elements.get(x))[0]!
    expect(run({ kind: 'css', selector: '#shadow-btn' }).status).toBe('valid')
    expect(run({ kind: 'role', role: 'button', name: 'Shadow' }).status).toBe('valid')
    expect(run({ kind: 'xpath', selector: '//button[@id="shadow-btn"]' }).status).toBe('not-found')
  })
})

describe('batches', () => {
  it('handles unsupported and failing items individually', () => {
    const s = scan(PAGE)
    const id = s.idOf('login')
    const items: ValidationRequestItem[] = [
      { locatorId: 'a', elementId: id, expression: 'a', query: { kind: 'css', selector: '#login' } },
      { locatorId: 'b', elementId: id, expression: 'b', query: { kind: 'magic' } as unknown as LocatorQuery },
      { locatorId: 'c', elementId: id, expression: 'c', query: { kind: 'css', selector: ':::' } },
      { locatorId: 'd', elementId: id, expression: 'd', query: { kind: 'xpath', selector: '//button[@id="login"]' } },
    ]
    expect(validateLocators(document, items, s.lookup).map((r) => r.status)).toEqual(['valid', 'unsupported', 'invalid', 'valid'])
  })

  it('validates every generated candidate of a realistic page without errors', () => {
    const s = scan(PAGE)
    const locators = generateLocators(s.result.elements)
    const items: ValidationRequestItem[] = [...locators.values()].flatMap((r) =>
      r.locators.map((l) => ({ locatorId: l.id, elementId: r.elementId, expression: l.expression, query: l.query })),
    )
    const results = validateLocators(document, items, s.lookup)
    expect(results).toHaveLength(items.length)
    expect(results.some((r) => r.status === 'error' || r.status === 'unsupported')).toBe(false)
    const byId = new Map(results.map((r) => [r.locatorId, r]))
    // Each locator result is tied to the locator and expression it validated.
    for (const item of items) expect(byId.get(item.locatorId)!.expression).toBe(item.expression)
    // The email field's semantic candidates are confirmed.
    const email = locators.get(s.idOf('email'))!
    for (const strategy of ['testid', 'role', 'label', 'placeholder']) {
      const l = email.locators.find((x) => x.strategy === strategy)!
      expect(byId.get(l.id)!.status, l.expression).toBe('valid')
    }
  })
})
