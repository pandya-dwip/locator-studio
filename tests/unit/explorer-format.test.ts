import { describe, expect, it } from 'vitest'
import { elementKind, filterElements, identifier, searchText } from '../../src/features/explorer/format'
import type { ScannedElement } from '../../src/shared/types'

function element(id: string, partial: Partial<ScannedElement>): ScannedElement {
  return {
    id,
    tagName: 'div',
    category: 'text',
    categories: ['text'],
    hints: [],
    attributes: {},
    visibility: 'visible',
    visibilityReason: 'rendered',
    inViewport: true,
    enabledState: 'not-applicable',
    childElementCount: 0,
    depth: 0,
    inShadowRoot: false,
    isCustomElement: false,
    properties: {},
    ...partial,
  }
}

const elements = [
  element('a', { tagName: 'button', category: 'interactive', accessibleName: 'Save draft', attributes: { id: 'save', class: 'btn primary' } }),
  element('b', { tagName: 'input', category: 'form', attributes: { name: 'email', 'data-testid': 'email-field' } }),
  element('c', { tagName: 'h1', textContent: 'Welcome back' }),
]
const index = new Map(elements.map((e) => [e.id, searchText(e)]))
const ids = (list: ScannedElement[]) => list.map((e) => e.id)

describe('explorer search and filter', () => {
  it('matches tag, id, class, name, text and attribute values, case-insensitively', () => {
    expect(ids(filterElements(elements, index, 'BUTTON', 'all'))).toEqual(['a'])
    expect(ids(filterElements(elements, index, 'save', 'all'))).toEqual(['a'])
    expect(ids(filterElements(elements, index, 'primary', 'all'))).toEqual(['a'])
    expect(ids(filterElements(elements, index, 'email-field', 'all'))).toEqual(['b'])
    expect(ids(filterElements(elements, index, 'welcome', 'all'))).toEqual(['c'])
  })

  it('requires every search term (AND) and combines with the category filter', () => {
    expect(ids(filterElements(elements, index, 'save primary', 'all'))).toEqual(['a'])
    expect(ids(filterElements(elements, index, 'save welcome', 'all'))).toEqual([])
    expect(ids(filterElements(elements, index, '', 'field'))).toEqual(['b'])
    expect(ids(filterElements(elements, index, 'save', 'field'))).toEqual([])
  })

  it('sorts elements into tester-facing tabs by role and tag', () => {
    const kind = (p: Partial<ScannedElement>) => elementKind(element('x', p))
    expect(kind({ tagName: 'button', role: 'button' })).toBe('button')
    expect(kind({ tagName: 'input', role: 'button', category: 'form' })).toBe('button') // type=submit
    expect(kind({ tagName: 'div', role: 'tab', category: 'interactive' })).toBe('button')
    expect(kind({ tagName: 'div', category: 'interactive', hints: ['onclick-attribute'] })).toBe('button')
    expect(kind({ tagName: 'a', role: 'link', category: 'interactive' })).toBe('link')
    expect(kind({ tagName: 'input', role: 'textbox', category: 'form' })).toBe('field')
    expect(kind({ tagName: 'div', role: 'checkbox', category: 'interactive' })).toBe('field')
    expect(kind({ tagName: 'select', category: 'form' })).toBe('field')
    expect(kind({ tagName: 'label', category: 'form' })).toBe('text')
    expect(kind({ tagName: 'h1', category: 'text' })).toBe('text')
    expect(kind({ tagName: 'img', category: 'media' })).toBe('media')
    expect(kind({ tagName: 'nav', category: 'navigation' })).toBe('structure')
    expect(kind({ tagName: 'form', category: 'form' })).toBe('structure')
  })

  it('builds short identifiers', () => {
    expect(identifier(elements[0]!)).toBe('#save')
    expect(identifier(elements[1]!)).toBe('name=email')
    expect(identifier(elements[2]!)).toBeUndefined()
  })
})
