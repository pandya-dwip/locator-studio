import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { scanDocument } from '../../src/core/scanner'
import type { ScannedElement, ScanResult } from '../../src/shared/types'

// jsdom has no layout engine, so give every element a box. Test-only attributes:
//   data-zero      → 0×0 box        data-one → 1×1 box        data-offscreen → box far below the viewport
//   data-boom      → measuring throws
function rect(x: number, y: number, width: number, height: number): DOMRect {
  return { x, y, width, height, top: y, left: x, right: x + width, bottom: y + height, toJSON() {} } as DOMRect
}

beforeEach(() => {
  document.title = ''
  document.head.innerHTML = ''
  document.body.innerHTML = ''
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.hasAttribute('data-boom')) throw new Error('cannot measure')
    if (this.hasAttribute('data-zero')) return rect(0, 0, 0, 0)
    if (this.hasAttribute('data-one')) return rect(10, 10, 1, 1)
    if (this.hasAttribute('data-offscreen')) return rect(10, 5000, 100, 20)
    return rect(10, 10, 100, 20)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

function scan(html: string, options?: Parameters<typeof scanDocument>[1]): ScanResult {
  document.body.innerHTML = html
  return scanDocument(document, options).result
}

/** Record for the element marked data-k="key". */
function el(result: ScanResult, key: string): ScannedElement {
  const found = result.elements.filter((e) => e.attributes['data-k'] === key)
  expect(found, `exactly one record for data-k=${key}`).toHaveLength(1)
  return found[0]!
}

function has(result: ScanResult, key: string): boolean {
  return result.elements.some((e) => e.attributes['data-k'] === key)
}

describe('interactive elements', () => {
  it('extracts buttons and links with roles, names and raw href', () => {
    const r = scan(`
      <button data-k="b">Save</button>
      <a data-k="a" href="/about?x=1">About us</a>
      <a data-k="nohref">Placeholder</a>`)
    expect(el(r, 'b')).toMatchObject({ tagName: 'button', category: 'interactive', role: 'button', roleSource: 'implicit', accessibleName: 'Save' })
    expect(el(r, 'a')).toMatchObject({ category: 'interactive', role: 'link', accessibleName: 'About us' })
    expect(el(r, 'a').attributes.href).toBe('/about?x=1') // DOM attribute, not resolved or fetched
    expect(el(r, 'nohref').role).toBeUndefined()
  })

  it('extracts ARIA widgets with explicit roles and state attributes', () => {
    const r = scan(`
      <div data-k="rb" role="button" tabindex="0">Open menu</div>
      <div data-k="cb" role="checkbox" aria-checked="true">Accept terms</div>
      <div data-k="tl" role="tablist"><span data-k="tab" role="tab" aria-selected="true">Overview</span></div>
      <div data-k="sl" role="slider" aria-valuenow="5" aria-label="Volume"></div>
      <div data-k="sw" role="switch" aria-checked="false">Dark mode</div>`)
    expect(el(r, 'rb')).toMatchObject({ category: 'interactive', role: 'button', roleSource: 'explicit', accessibleName: 'Open menu' })
    expect(el(r, 'rb').hints).toContain('tabindex')
    expect(el(r, 'cb').attributes['aria-checked']).toBe('true')
    expect(el(r, 'cb').accessibleName).toBe('Accept terms')
    expect(el(r, 'tl').category).toBe('navigation')
    expect(el(r, 'tab')).toMatchObject({ category: 'interactive', accessibleName: 'Overview' })
    expect(el(r, 'sl')).toMatchObject({ role: 'slider', accessibleName: 'Volume' })
    expect(el(r, 'sw').role).toBe('switch')
  })

  it('records an onclick attribute as a hint without inventing a button role', () => {
    const r = scan('<div data-k="c" onclick="steal()">Click me</div>')
    const c = el(r, 'c')
    expect(c.category).toBe('interactive')
    expect(c.hints).toContain('onclick-attribute')
    expect(c.role).toBeUndefined()
    expect(c.attributes.onclick).toBe('(inline handler)')
    expect(JSON.stringify(r)).not.toContain('steal()')
  })

  it('treats contenteditable hosts as interactive', () => {
    const r = scan('<div data-k="ed" contenteditable="true"></div><div data-k="ro" contenteditable="false">Fixed text</div>')
    expect(el(r, 'ed')).toMatchObject({ category: 'interactive', properties: { contentEditable: true } })
    expect(el(r, 'ed').hints).toContain('contenteditable')
    expect(el(r, 'ro').hints).not.toContain('contenteditable')
  })
})

describe('form elements', () => {
  it('names inputs from <label for>, wrapping labels, aria-labelledby and placeholder', () => {
    const r = scan(`
      <label for="email">Email address</label><input data-k="email" id="email" type="email" required>
      <label>Remember me <input data-k="remember" type="checkbox" checked></label>
      <span id="lbl">Search the site</span><input data-k="search" type="search" aria-labelledby="lbl">
      <input data-k="ph" placeholder="Your name">`)
    expect(el(r, 'email')).toMatchObject({ category: 'form', role: 'textbox', accessibleName: 'Email address', accessibleNameSource: 'label' })
    expect(el(r, 'email').properties).toMatchObject({ inputType: 'email', required: true })
    expect(el(r, 'remember')).toMatchObject({ role: 'checkbox', accessibleName: 'Remember me', properties: { checked: true } })
    expect(el(r, 'search')).toMatchObject({ role: 'searchbox', accessibleName: 'Search the site', accessibleNameSource: 'aria-labelledby' })
    expect(el(r, 'ph')).toMatchObject({ accessibleName: 'Your name', accessibleNameSource: 'placeholder' })
  })

  it('extracts textareas, selects and options without their contents as values', () => {
    const r = scan(`
      <textarea data-k="ta" required>Prefilled note</textarea>
      <select data-k="sel" name="country">
        <option data-k="us" value="us">United States</option>
        <option data-k="ca" value="ca" selected>Canada</option>
      </select>`)
    expect(el(r, 'ta')).toMatchObject({ category: 'form', role: 'textbox', textContent: undefined, properties: { required: true } })
    expect(el(r, 'ta').categories).toEqual(['form', 'interactive'])
    expect(el(r, 'sel')).toMatchObject({ role: 'combobox', textContent: undefined })
    expect(el(r, 'ca')).toMatchObject({ category: 'form', accessibleName: 'Canada', properties: { selected: true } })
    expect(el(r, 'ca').attributes.value).toBe('ca') // markup option value, not user input
    expect(el(r, 'us').properties.selected).toBe(false)
    expect(JSON.stringify(r)).not.toContain('Prefilled note')
  })

  it('extracts forms, fieldsets, legends and labels', () => {
    const r = scan(`
      <form data-k="f" action="/login" method="post">
        <fieldset data-k="fs"><legend data-k="lg">Account</legend>
          <label data-k="lb" for="u">User</label><input id="u" name="user">
        </fieldset>
      </form>`)
    expect(el(r, 'f')).toMatchObject({ category: 'form', role: undefined }) // unnamed form: no landmark role
    expect(el(r, 'f').attributes).toMatchObject({ action: '/login', method: 'post' })
    expect(el(r, 'fs')).toMatchObject({ category: 'form', accessibleName: 'Account' })
    expect(el(r, 'lg').category).toBe('form')
    expect(el(r, 'lb').category).toBe('form')
  })
})

describe('text, structure, media', () => {
  it('extracts headings and meaningful text without flooding generic containers', () => {
    const r = scan(`
      <h1 data-k="h">Welcome</h1>
      <p data-k="p">Some <em data-k="em">paragraph</em> text</p>
      <div><span data-k="leaf">Standalone note</span></div>
      <button><span data-k="inner">Inner label</span></button>
      <div data-k="wrapper"><div data-k="one">a</div></div>`)
    expect(el(r, 'h')).toMatchObject({ category: 'text', role: 'heading', accessibleName: 'Welcome' })
    expect(el(r, 'p').textContent).toBe('Some paragraph text')
    expect(el(r, 'leaf').category).toBe('text')
    expect(has(r, 'em')).toBe(false) // covered by the paragraph
    expect(has(r, 'inner')).toBe(false) // covered by the button
    expect(has(r, 'wrapper')).toBe(false) // generic container
    expect(has(r, 'one')).toBe(false) // single character
  })

  it('categorises landmarks, tables and lists', () => {
    const r = scan(`
      <header data-k="hdr"></header>
      <nav data-k="nav"><ul data-k="ul"><li data-k="li"><a data-k="home" href="/">Home</a></li></ul></nav>
      <main data-k="main"><section data-k="sec" aria-label="Intro"></section><article data-k="art"></article></main>
      <table data-k="tbl"><thead><tr><th data-k="th">Name</th></tr></thead><tbody><tr><td data-k="td">Ann</td></tr></tbody></table>
      <aside data-k="aside"></aside><footer data-k="ftr"></footer>`)
    expect(el(r, 'hdr')).toMatchObject({ category: 'structural', role: 'banner' })
    expect(el(r, 'nav')).toMatchObject({ category: 'navigation', role: 'navigation' })
    expect(el(r, 'ul').category).toBe('list')
    expect(el(r, 'li').category).toBe('list')
    expect(el(r, 'home').categories).toEqual(['interactive', 'navigation'])
    expect(el(r, 'main')).toMatchObject({ category: 'structural', role: 'main' })
    expect(el(r, 'sec')).toMatchObject({ role: 'region', accessibleName: 'Intro' })
    expect(el(r, 'art').category).toBe('structural')
    expect(el(r, 'tbl').category).toBe('table')
    expect(el(r, 'th')).toMatchObject({ category: 'table', role: 'columnheader', textContent: 'Name' })
    expect(el(r, 'td').textContent).toBe('Ann')
    expect(el(r, 'aside').role).toBe('complementary')
    expect(el(r, 'ftr').role).toBe('contentinfo')
  })

  it('extracts media and links inside SVG, but not SVG shapes', () => {
    const r = scan(`
      <img data-k="img" src="/logo.png" alt="Company logo">
      <img data-k="data" src="data:image/png;base64,${'A'.repeat(500)}" alt="">
      <svg data-k="svg" aria-label="Chart"><g><path data-k="path" d="M0 0"></path><a data-k="svga" href="/x"><text>Go</text></a></g></svg>
      <video data-k="vid"></video><audio data-k="aud"></audio>`)
    expect(el(r, 'img')).toMatchObject({ category: 'media', role: 'img', accessibleName: 'Company logo' })
    expect(el(r, 'data').attributes.src).toMatch(/^data:… \(\d+ chars\)$/)
    expect(el(r, 'svg')).toMatchObject({ category: 'media', accessibleName: 'Chart' })
    expect(has(r, 'path')).toBe(false)
    expect(el(r, 'svga').category).toBe('interactive')
    expect(el(r, 'vid').category).toBe('media')
    expect(el(r, 'aud').category).toBe('media')
  })

  it('records iframes without scanning into them', () => {
    const r = scan('<iframe data-k="fr" src="https://example.com/" title="Ad"></iframe>')
    expect(el(r, 'fr')).toMatchObject({ category: 'media', accessibleName: 'Ad' })
    expect(r.summary.framesNotScanned).toBe(1)
  })
})

describe('identity', () => {
  it('keeps ids and test ids, and extracts generic elements that carry a test id', () => {
    const r = scan('<div data-testid="card"><span>Price</span><strong>$10</strong></div><button id="buy">Buy</button>')
    const card = r.elements.find((e) => e.attributes['data-testid'] === 'card')!
    expect(card.category).toBe('structural')
    expect(card.hints).toContain('test-id')
    expect(r.elements.find((e) => e.attributes.id === 'buy')?.tagName).toBe('button')
  })

  it('keeps separate records for elements with duplicate ids', () => {
    const r = scan('<button id="dup">One</button><button id="dup">Two</button>')
    const dups = r.elements.filter((e) => e.attributes.id === 'dup')
    expect(dups.map((d) => d.accessibleName)).toEqual(['One', 'Two'])
    expect(new Set(dups.map((d) => d.id)).size).toBe(2)
  })

  it('maps every scan id back to the right live element', () => {
    document.body.innerHTML = '<button data-k="x">X</button><a data-k="y" href="#">Y</a>'
    const { result, elements } = scanDocument(document)
    for (const record of result.elements) {
      expect(elements.get(record.id)?.getAttribute('data-k')).toBe(record.attributes['data-k'])
    }
  })
})

describe('no duplicates', () => {
  it('produces one record per element even when it matches several rules', () => {
    document.body.innerHTML = `
      <form><label>Name <input data-k="in" name="n" data-testid="name" tabindex="0" onclick="x()"></label>
      <button data-k="btn" role="button">Send</button></form>
      <nav><a data-k="nl" href="/x" role="link">X</a></nav>`
    const { result, elements } = scanDocument(document)
    expect(el(result, 'in').categories).toEqual(['form', 'interactive'])
    expect(el(result, 'btn').categories).toEqual(['interactive', 'form'])
    expect(el(result, 'nl').categories).toEqual(['interactive', 'navigation'])
    expect(new Set(elements.values()).size).toBe(result.elements.length)
    expect(new Set(result.elements.map((e) => e.id)).size).toBe(result.elements.length)
  })
})

describe('visibility', () => {
  it('distinguishes not-rendered, hidden, zero-size and off-screen', () => {
    const r = scan(`
      <button data-k="none" style="display:none">x</button>
      <button data-k="attr" hidden>x</button>
      <div style="display:none"><button data-k="anc">x</button></div>
      <button data-k="vh" style="visibility:hidden">x</button>
      <button data-k="op" style="opacity:0">x</button>
      <div style="opacity:0"><button data-k="opc">x</button></div>
      <button data-k="zero" data-zero>x</button>
      <span data-k="sr" data-one>Screen reader only</span>
      <button data-k="off" data-offscreen>x</button>
      <button data-k="ok">x</button>`)
    expect(el(r, 'none')).toMatchObject({ visibility: 'not-rendered', visibilityReason: 'display-none' })
    expect(el(r, 'attr')).toMatchObject({ visibility: 'not-rendered', visibilityReason: 'hidden-attribute' })
    expect(el(r, 'anc')).toMatchObject({ visibility: 'not-rendered', visibilityReason: 'ancestor-not-rendered' })
    expect(el(r, 'vh')).toMatchObject({ visibility: 'hidden', visibilityReason: 'visibility-hidden' })
    expect(el(r, 'op')).toMatchObject({ visibility: 'hidden', visibilityReason: 'opacity-zero' })
    expect(el(r, 'opc')).toMatchObject({ visibility: 'hidden', visibilityReason: 'opacity-zero' })
    expect(el(r, 'zero')).toMatchObject({ visibility: 'hidden', visibilityReason: 'zero-size' })
    expect(el(r, 'sr')).toMatchObject({ visibility: 'hidden', visibilityReason: 'visually-hidden' })
    // Off-screen is still visible: the user can scroll to it.
    expect(el(r, 'off')).toMatchObject({ visibility: 'visible', visibilityReason: 'outside-viewport', inViewport: false })
    expect(el(r, 'ok')).toMatchObject({ visibility: 'visible', visibilityReason: 'rendered', inViewport: true })
    expect(r.summary.byVisibility).toMatchObject({ visible: 2, hidden: 5, 'not-rendered': 3 })
  })

  it('reports an element covered by another element as obscured', () => {
    document.body.innerHTML = '<button data-k="under">x</button><div id="overlay"></div>'
    const overlay = document.getElementById('overlay')!
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => overlay })
    try {
      const { result } = scanDocument(document)
      expect(el(result, 'under')).toMatchObject({ visibility: 'obscured', visibilityReason: 'covered-by-other-element' })
    } finally {
      delete (document as { elementFromPoint?: unknown }).elementFromPoint
    }
  })

  it('gives options the visibility of their select', () => {
    const r = scan('<select><option data-k="o">A</option></select><select style="display:none"><option data-k="h">B</option></select>')
    expect(el(r, 'o')).toMatchObject({ visibility: 'visible', visibilityReason: 'inherited-from-select' })
    expect(el(r, 'h').visibility).toBe('not-rendered')
  })
})

describe('enabled state', () => {
  it('detects native, fieldset-inherited and aria disabled, and readonly separately', () => {
    const r = scan(`
      <button data-k="dis" disabled>x</button>
      <fieldset disabled><input data-k="fs" type="text"></fieldset>
      <div data-k="ad" role="button" aria-disabled="true">x</div>
      <div aria-disabled="true"><a data-k="adc" href="#">x</a></div>
      <input data-k="ro" type="text" readonly>
      <textarea data-k="rota" readonly></textarea>
      <div data-k="aro" role="textbox" aria-readonly="true"></div>
      <input data-k="en" type="text">
      <h2 data-k="na">Title</h2>
      <section data-k="sec" aria-label="Main"></section>`)
    expect(el(r, 'dis').enabledState).toBe('disabled')
    expect(el(r, 'fs').enabledState).toBe('disabled')
    expect(el(r, 'ad').enabledState).toBe('disabled')
    expect(el(r, 'adc').enabledState).toBe('disabled')
    expect(el(r, 'ro')).toMatchObject({ enabledState: 'readonly', properties: { readOnly: true } })
    expect(el(r, 'rota').enabledState).toBe('readonly')
    expect(el(r, 'aro').enabledState).toBe('readonly')
    expect(el(r, 'en').enabledState).toBe('enabled')
    expect(el(r, 'na').enabledState).toBe('not-applicable')
    expect(el(r, 'sec').enabledState).toBe('not-applicable')
    // button, the fieldset itself, its input, and two aria-disabled elements
    expect(r.summary.disabledElements).toBe(5)
  })
})

describe('custom elements and shadow DOM', () => {
  it('captures custom elements without assuming they are interactive', () => {
    const r = scan(`
      <my-widget data-k="w" size="large" aria-label="Widget">content</my-widget>
      <fancy-button data-k="fb" role="button" aria-pressed="false">Go</fancy-button>
      <x-empty data-k="x"></x-empty>`)
    expect(el(r, 'w')).toMatchObject({ category: 'custom', isCustomElement: true, accessibleName: 'Widget', enabledState: 'not-applicable' })
    expect(el(r, 'w').attributes.size).toBe('large')
    expect(el(r, 'fb').categories).toEqual(['interactive', 'custom'])
    expect(el(r, 'fb').attributes['aria-pressed']).toBe('false')
    expect(el(r, 'x').categories).toEqual(['custom'])
  })

  it('scans open shadow roots once and cannot see closed ones', () => {
    const host = document.createElement('my-card')
    host.setAttribute('data-k', 'host')
    host.attachShadow({ mode: 'open' }).innerHTML = '<button data-k="sb">Shadow button</button><slot></slot>'
    host.innerHTML = '<span data-k="light">Light text</span>'
    const closed = document.createElement('my-secret')
    closed.attachShadow({ mode: 'closed' }).innerHTML = '<button data-k="cb">Hidden</button>'
    document.body.append(host, closed)

    const { result } = scanDocument(document)
    const sb = el(result, 'sb')
    expect(sb.inShadowRoot).toBe(true)
    expect(sb.parentId).toBe(el(result, 'host').id)
    expect(sb.parentTagName).toBe('my-card')
    expect(el(result, 'light').inShadowRoot).toBe(false)
    expect(has(result, 'cb')).toBe(false)
    expect(result.summary.shadowRootsScanned).toBe(1)
  })
})

describe('robustness', () => {
  it('handles an empty document', () => {
    const r = scan('')
    expect(r.elements).toEqual([])
    expect(r.summary.totalElements).toBe(0)
    expect(Object.values(r.summary.byCategory).every((n) => n === 0)).toBe(true)
  })

  it('handles malformed markup', () => {
    const r = scan('<div><p>Unclosed <b>bold<li>stray item<table><td>cell</div><button data-k="ok">ok<x-y z=1 =bad>')
    expect(el(r, 'ok').category).toBe('interactive')
    expect(r.summary.skippedElements).toBe(0)
  })

  it('skips an element that throws and keeps scanning', () => {
    const r = scan('<button data-k="a">A</button><button data-k="boom" data-boom>B</button><button data-k="c">C</button>')
    expect(r.summary.skippedElements).toBe(1)
    expect(has(r, 'boom')).toBe(false)
    expect(has(r, 'a') && has(r, 'c')).toBe(true)
  })

  it('scans a large DOM and stops at the element limit', () => {
    const items = Array.from({ length: 3000 }, (_, i) => `<li><a href="/item/${i}">Item ${i}</a></li>`).join('')
    const r = scan(`<ul>${items}</ul>`)
    expect(r.summary.truncated).toBe(true)
    expect(r.elements).toHaveLength(5000)
    expect(r.summary.elementLimit).toBe(5000)

    const small = scan(`<ul>${items}</ul>`, { maxElements: 100 })
    expect(small.elements).toHaveLength(100)
    expect(small.summary.truncated).toBe(true)
  })

  it('caps text previews', () => {
    const r = scan(`<p data-k="long">${'word '.repeat(2000)}</p>`)
    expect(el(r, 'long').textContent!.length).toBeLessThanOrEqual(200)
  })
})

describe('privacy', () => {
  it('never collects input values, hidden inputs, editable content or sensitive data attributes', () => {
    document.body.innerHTML = `
      <input data-k="pw" type="password" value="hunter2-attr" autocomplete="current-password">
      <input data-k="txt" type="text" value="prefilled-attr">
      <input type="hidden" name="csrf" value="csrf-secret-123">
      <textarea data-k="ta">draft-secret-text</textarea>
      <div data-k="ed" contenteditable="true"><p data-k="edp">typed-secret-paragraph</p></div>
      <div data-k="dt" data-testid="safe" data-token="tok-secret" data-user-email="a@b.c">x</div>`
    ;(document.querySelector('[data-k="pw"]') as HTMLInputElement).value = 'hunter2-prop'
    ;(document.querySelector('[data-k="txt"]') as HTMLInputElement).value = 'typed-prop'
    ;(document.querySelector('[data-k="ta"]') as HTMLTextAreaElement).value = 'typed-textarea'

    const { result } = scanDocument(document)
    const json = JSON.stringify(result)
    for (const secret of [
      'hunter2-attr', 'hunter2-prop', 'prefilled-attr', 'typed-prop', 'csrf-secret-123',
      'draft-secret-text', 'typed-textarea', 'typed-secret-paragraph', 'tok-secret', 'a@b.c',
    ]) {
      expect(json, secret).not.toContain(secret)
    }
    expect(el(result, 'pw').properties.inputType).toBe('password')
    expect(el(result, 'pw').attributes.autocomplete).toBe('current-password')
    expect(result.elements.some((e) => e.attributes.name === 'csrf')).toBe(false)
    expect(el(result, 'dt').attributes['data-testid']).toBe('safe')
  })
})

describe('scope', () => {
  it('generates no selectors, XPath or locators', () => {
    const r = scan(`
      <form><label for="q">Query</label><input id="q" name="q"><button type="submit">Go</button></form>
      <nav><a href="/">Home</a></nav><h1>Title</h1>`)
    const keys = new Set<string>()
    const collect = (value: unknown) => {
      if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) {
          keys.add(k)
          collect(v)
        }
      }
    }
    collect(r)
    expect([...keys].filter((k) => /selector|xpath|locator|css/i.test(k))).toEqual([])
    expect(JSON.stringify(r)).not.toMatch(/getBy(Role|Text|Label|TestId)|\/\/(html|body|div)\b|nth-child/)
  })
})
