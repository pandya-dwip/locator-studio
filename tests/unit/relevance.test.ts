import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { scanDocument } from '../../src/core/scanner'
import { findNoise, isMessage } from '../../src/shared/relevance'

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, left: 0, width: 100, height: 20, right: 100, bottom: 20, toJSON() {} } as DOMRect)
})
afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

// A typical site layout: desktop nav, a hidden mobile copy of it, icons, a form.
const PAGE = `
  <header data-k="header" id="site-header">
    <span data-k="tagline">Practice makes perfect</span>
    <div data-k="secondary" id="menu-secondary" role="navigation"><a href="/about">About</a> | <a href="/contact">Contact</a></div>
    <nav data-k="nav" aria-label="Main">
      <ul data-k="ul" id="menu-primary-items">
        <li data-k="li-home"><a data-k="a-home" href="/">Home</a></li>
        <li data-k="li-blog"><a data-k="a-blog" href="/blog">Blog</a></li>
      </ul>
    </nav>
    <button data-k="menu-btn" aria-label="open menu"><svg data-k="menu-icon" aria-label="menu"></svg></button>
    <nav data-k="mobile-nav" style="display:none"><a data-k="a-home-mobile" href="/">Home</a></nav>
  </header>
  <main>
    <section data-k="section" id="main-container">
      <h2 data-k="h2">Test login</h2>
      <p data-k="intro">Use the account below.</p>
      <p data-k="with-link">Read the <a href="/docs">documentation</a> before you start.</p>
      <img data-k="logo" src="/logo.png" alt="Company logo">
      <svg data-k="deco"></svg>
      <form data-k="form">
        <label data-k="label" for="user">Username</label><input data-k="user" id="user" name="username">
        <input data-k="fancy" type="checkbox" style="opacity:0" aria-label="Accept terms">
        <button data-k="submit">Submit</button>
      </form>
      <div data-k="card" data-testid="result-card"><span>Result</span><b>ok</b></div>
      <table><tbody><tr data-k="tr"><td data-k="td-link"><a data-k="a-cell" href="/x">Open</a></td><td data-k="td-text">Pending</td></tr></tbody></table>
    </section>
  </main>`

function noiseOf(html: string) {
  document.body.innerHTML = html
  const { result } = scanDocument(document)
  const noise = findNoise(result.elements)
  return (key: string) => {
    const el = result.elements.find((e) => e.attributes['data-k'] === key)
    if (!el) throw new Error(`not scanned: ${key}`)
    return noise.get(el.id) ?? 'useful'
  }
}

describe('noise detection', () => {
  it('hides layout containers, wrappers, hidden duplicates, decorative icons and labels', () => {
    const reason = noiseOf(PAGE)
    expect(reason('header')).toBe('layout')
    expect(reason('secondary')).toBe('wrapper') // nav <div> whose text is just its links
    expect(reason('nav')).toBe('layout')
    expect(reason('ul')).toBe('layout')
    expect(reason('section')).toBe('layout')
    expect(reason('form')).toBe('layout')
    expect(reason('tr')).toBe('layout')
    expect(reason('li-home')).toBe('wrapper') // only repeats its link
    expect(reason('td-link')).toBe('wrapper')
    expect(reason('mobile-nav')).toBe('hidden')
    expect(reason('a-home-mobile')).toBe('hidden')
    expect(reason('menu-icon')).toBe('decorative') // icon inside a button
    expect(reason('deco')).toBe('decorative') // unnamed svg
    expect(reason('label')).toBe('label')
  })

  it('keeps what tests interact with or assert on', () => {
    const reason = noiseOf(PAGE)
    // with-link: a paragraph with its own words around a link is not a wrapper.
    for (const key of ['a-home', 'a-blog', 'menu-btn', 'h2', 'intro', 'with-link', 'tagline', 'logo', 'user', 'submit', 'a-cell', 'td-text', 'card']) {
      expect(reason(key), key).toBe('useful')
    }
  })

  it('keeps hidden status and error messages: they appear later and tests assert on them', () => {
    const reason = noiseOf(`
      <div data-k="error" id="error" style="display:none">Your username is invalid!</div>
      <div data-k="alert" role="alert" hidden>Saved</div>
      <p data-k="live" aria-live="polite" style="display:none">3 results</p>
      <p data-k="other" style="display:none">Hidden promo text</p>`)
    expect(reason('error')).toBe('useful')
    expect(reason('alert')).toBe('useful')
    expect(reason('live')).toBe('useful')
    expect(reason('other')).toBe('hidden')
  })

  it('treats empty error slots as messages, but never buttons with message-like classes', () => {
    document.body.innerHTML = `
      <div data-k="slot" id="error" style="display:none"></div>
      <div data-k="toast" class="toast-container"></div>
      <button data-k="btn" class="btn btn-success">Save</button>
      <div data-k="word" class="errorless-layout"><p>x</p></div>`
    const { result } = scanDocument(document)
    const byKey = (k: string) => result.elements.find((e) => e.attributes['data-k'] === k)
    const noise = findNoise(result.elements)
    expect(byKey('slot')).toBeDefined() // extracted although empty
    expect(noise.has(byKey('slot')!.id)).toBe(false) // and shown although hidden
    expect(noise.has(byKey('toast')!.id)).toBe(false)
    expect(isMessage(byKey('btn')!)).toBe(false)
    expect(byKey('word')).toBeUndefined() // "errorless" is not the word "error"
  })

  it('keeps visually hidden but interactive controls (custom checkboxes)', () => {
    expect(noiseOf(PAGE)('fancy')).toBe('useful')
  })

  it('removes most of a typical layout', () => {
    document.body.innerHTML = PAGE
    const { result } = scanDocument(document)
    const noise = findNoise(result.elements)
    expect(noise.size).toBeGreaterThanOrEqual(result.elements.length / 3)
  })
})
