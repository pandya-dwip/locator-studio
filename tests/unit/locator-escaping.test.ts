import { afterEach, describe, expect, it } from 'vitest'
import { cssIdent, cssString, jsString, objectLiteral, pageCall, xpathString } from '../../src/core/locator-engine/utils/escaping'

const TRICKY = [
  '',
  'plain',
  "it's",
  'say "hi"',
  `both ' and "`,
  'back\\slash',
  'line\nbreak',
  'carriage\rreturn',
  'tab\there',
  'separators    ',
  'control \x00 \x01 \x1f \x7f',
  'emoji 😀 and 東京 and Café',
  '} ) ]; alert(1); //',
  '${template}',
]

// jsdom's selector engine cannot match astral characters (even unescaped), and its XPath
// wrongly matches <html> for `[@attr=""]`. Browsers handle both; those inputs are
// checked as exact strings instead of against the DOM.
const jsdomSafe = (v: string) => !/[\u{10000}-\u{10FFFF}]/u.test(v)

afterEach(() => {
  document.body.innerHTML = ''
})

describe('jsString', () => {
  it.each(TRICKY)('round-trips %j through a JavaScript parser', (value) => {
    const literal = jsString(value)
    expect(literal.startsWith("'") && literal.endsWith("'")).toBe(true)
    expect(new Function(`"use strict"; return ${literal}`)()).toBe(value)
  })

  it('keeps printable Unicode readable', () => {
    expect(jsString('Café 東京 😀')).toBe("'Café 東京 😀'")
  })
})

describe('cssIdent', () => {
  it.each(['simple', '1starts-with-digit', '-1x', '-', '--custom', 'a.b:c', 'with space', 'quo"te', 'a\\b', '東京', '#hash', 'x\ny'])(
    'escapes id %j so querySelector finds the element',
    (id) => {
      const el = document.createElement('div')
      el.id = id
      document.body.append(el)
      expect(document.querySelector(`#${cssIdent(id)}`)).toBe(el)
    },
  )

  it('matches the CSSOM CSS.escape output for common cases', () => {
    expect(cssIdent('login-button')).toBe('login-button')
    expect(cssIdent('1a')).toBe('\\31 a')
    expect(cssIdent('a.b')).toBe('a\\.b')
    expect(cssIdent('-')).toBe('\\-')
    expect(cssIdent('emoji😀')).toBe('emoji😀') // >= U+0080 is never escaped
  })
})

describe('cssString', () => {
  it.each(TRICKY.filter((v) => !v.includes('\x00') && jsdomSafe(v)))('matches attribute value %j exactly', (value) => {
    const el = document.createElement('div')
    el.setAttribute('data-x', value)
    document.body.append(el)
    expect(document.querySelector(`[data-x=${cssString(value)}]`)).toBe(el)
  })
})

describe('xpathString', () => {
  it('uses the quote style that needs no escaping and concat() for mixed quotes', () => {
    expect(xpathString('plain')).toBe('"plain"')
    expect(xpathString('say "hi"')).toBe(`'say "hi"'`)
    expect(xpathString(`it's "both"`)).toBe(`concat("it's ", '"', "both", '"', "")`)
    expect(xpathString('')).toBe('""')
    expect(xpathString('😀 東京')).toBe('"😀 東京"')
  })

  it.each(TRICKY.filter((v) => v !== '' && jsdomSafe(v) && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v)))('matches attribute value %j exactly', (value) => {
    const el = document.createElement('div')
    el.setAttribute('data-x', value)
    document.body.append(el)
    const found = document.evaluate(`//*[@data-x=${xpathString(value)}]`, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
    expect(found.singleNodeValue).toBe(el)
  })
})

describe('expression building', () => {
  it('builds page calls with escaped arguments and drops undefined options', () => {
    expect(pageCall('getByRole', 'button', { name: "O'Neil", level: undefined })).toBe(`page.getByRole('button', { name: 'O\\'Neil' })`)
    expect(pageCall('getByRole', 'heading', { name: 'Title', level: 2, exact: true })).toBe(
      `page.getByRole('heading', { name: 'Title', level: 2, exact: true })`,
    )
    expect(pageCall('getByText', 'Hi')).toBe(`page.getByText('Hi')`)
    expect(objectLiteral({ a: undefined })).toBeUndefined()
  })
})
