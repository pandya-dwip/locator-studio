// Form detection for generated Page Objects. One FormSpec drives the page
// method (login(), submitXForm()), its test data and its spec, so the three
// generated files always agree on parameters.
import { elementKind } from '../../shared/element-kind'
import { isMessage } from '../../shared/relevance'
import type { ScannedElement } from '../../shared/types'
import { camelCase, createNameRegistry, toIdentifier, words } from './naming'

export type ParamKind =
  | 'text' | 'email' | 'password' | 'search' | 'tel' | 'url' | 'number' | 'date' | 'textarea'
  | 'select' | 'checkbox' | 'radio'

export type FieldAction = 'fill' | 'selectOption' | 'setChecked' | 'check'

export interface FormParam {
  /** Parameter / test-data property name. */
  name: string
  kind: ParamKind
  type: 'string' | 'boolean'
  action: FieldAction
  label: string
  required: boolean
  constraints: { minLength?: number; maxLength?: number; min?: number; max?: number }
  /** Select options and radio choices (value + visible label). */
  options: { value: string; label: string }[]
  /** Page Object property filled by this parameter (selects, inputs, checkboxes). */
  property?: string
  /** Radios: property per option value. */
  radioProperties?: Record<string, string>
  elementIds: string[]
}

export interface FormSpec {
  /** Page Object method name (also the test-data key). */
  method: string
  title: string
  params: FormParam[]
  /** Property of the submit button. */
  submit: string
  /** Property of the status/error message shown after submitting, when one was found. */
  message?: string
  kind: 'login' | 'search' | 'form'
}

/** The minimal view of a Page Object property this module needs. */
export interface FormProperty {
  elementId: string
  name: string
}

const TEXT_INPUT_KINDS: Record<string, ParamKind> = {
  text: 'text', email: 'email', password: 'password', search: 'search', tel: 'tel', url: 'url', number: 'number',
  date: 'date', 'datetime-local': 'date', month: 'date', time: 'date', week: 'date',
}

/** How the element is filled, or undefined when it is not a form input. */
export function fieldKind(el: ScannedElement): ParamKind | undefined {
  if (el.tagName === 'select') return 'select'
  if (el.role === 'radio') return 'radio'
  if (el.role === 'checkbox' || el.role === 'switch') return 'checkbox'
  if (el.tagName === 'textarea') return 'textarea'
  if (el.tagName === 'input') return TEXT_INPUT_KINDS[el.properties.inputType ?? 'text']
  if (el.role === 'searchbox') return 'search'
  if (el.role === 'textbox' || el.role === 'spinbutton' || el.hints.includes('contenteditable')) return 'text'
  return undefined
}

const ACTION_FOR: Record<ParamKind, FieldAction> = {
  text: 'fill', email: 'fill', password: 'fill', search: 'fill', tel: 'fill', url: 'fill', number: 'fill',
  date: 'fill', textarea: 'fill', select: 'selectOption', checkbox: 'setChecked', radio: 'check',
}

function isSubmit(el: ScannedElement): boolean {
  const type = el.attributes.type?.toLowerCase()
  if (el.tagName === 'button') return !type || type === 'submit'
  return el.tagName === 'input' && (type === 'submit' || type === 'image')
}

const ACTION_WORDS = /\b(submit|log ?in|sign ?in|sign ?up|register|continue|next|send|search|go|save|apply|create|confirm)\b/i

/** A button outside a <form> that clearly submits something (not "open menu", "close"). */
function isNamedAction(el: ScannedElement): boolean {
  if (elementKind(el) !== 'button') return false
  const name = el.accessibleName ?? el.textContent ?? el.attributes.value ?? ''
  return ACTION_WORDS.test(name) || el.attributes.type?.toLowerCase() === 'submit'
}

function formOf(el: ScannedElement, byId: Map<string, ScannedElement>): ScannedElement | undefined {
  for (let p = el.parentId ? byId.get(el.parentId) : undefined; p; p = p.parentId ? byId.get(p.parentId) : undefined) {
    if (p.tagName === 'form') return p
  }
  return undefined
}

const PARAM_SUFFIXES = new Set(['input', 'select', 'checkbox', 'switch', 'field', 'textarea', 'radio'])

function paramName(source: string, taken: (n: string) => string): string {
  const ws = words(source)
  if (ws.length > 1 && PARAM_SUFFIXES.has(ws[ws.length - 1]!.toLowerCase())) ws.pop()
  return taken(toIdentifier(camelCase(ws), 'value'))
}

const num = (v: string | undefined) => (v !== undefined && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined)

function selectOptions(select: ScannedElement, elements: ScannedElement[], byId: Map<string, ScannedElement>) {
  return elements
    .filter((o) => {
      if (o.tagName !== 'option') return false
      const parent = o.parentId ? byId.get(o.parentId) : undefined
      return o.parentId === select.id || (parent?.tagName === 'optgroup' && parent.parentId === select.id)
    })
    .map((o) => ({ value: (o.attributes.value ?? o.textContent ?? '').trim(), label: (o.textContent ?? o.attributes.value ?? '').trim() }))
}

/**
 * Forms whose submission the scanned structure supports: fillable fields plus
 * exactly one submit button, grouped by <form> (fields outside any form form
 * one page-level group whose submit must be the only clearly named action).
 */
export function detectForms(
  properties: FormProperty[],
  elements: ScannedElement[],
  nameFor: (name: string) => string,
): FormSpec[] {
  const byId = new Map(elements.map((e) => [e.id, e]))
  const groups = new Map<ScannedElement | null, FormProperty[]>()
  for (const p of properties) {
    const form = formOf(byId.get(p.elementId)!, byId) ?? null
    groups.set(form, [...(groups.get(form) ?? []), p])
  }

  const specs: FormSpec[] = []
  const pageMessages = (groups.get(null) ?? []).filter((p) => isMessage(byId.get(p.elementId)!))
  for (const [form, props] of groups) {
    const submits = props.filter((p) => (form ? isSubmit(byId.get(p.elementId)!) : isNamedAction(byId.get(p.elementId)!)))
    const fieldProps = props.filter((p) => fieldKind(byId.get(p.elementId)!))
    if (fieldProps.length === 0 || submits.length !== 1) continue

    const paramFor = createNameRegistry()
    const params: FormParam[] = []
    const radioGroups = new Map<string, FormParam>()
    for (const p of fieldProps) {
      const el = byId.get(p.elementId)!
      const kind = fieldKind(el)!
      const required = el.properties.required === true || el.attributes['aria-required'] === 'true'
      if (kind === 'radio') {
        const group = el.attributes.name ?? p.name
        const value = el.attributes.value ?? el.accessibleName ?? p.name
        let param = radioGroups.get(group)
        if (!param) {
          param = {
            name: paramFor(toIdentifier(camelCase(words(group)), 'choice')),
            kind, type: 'string', action: 'check', label: group, required, constraints: {}, options: [],
            radioProperties: {}, elementIds: [],
          }
          radioGroups.set(group, param)
          params.push(param)
        }
        param.options.push({ value, label: el.accessibleName ?? value })
        param.radioProperties![value] = p.name
        param.elementIds.push(el.id)
        param.required ||= required
        continue
      }
      params.push({
        name: paramFor(p.name), // placeholder, renamed below once the method kind is known
        kind,
        type: kind === 'checkbox' ? 'boolean' : 'string',
        action: ACTION_FOR[kind],
        label: el.accessibleName ?? el.attributes.placeholder ?? el.attributes.name ?? p.name,
        required,
        constraints: {
          minLength: num(el.attributes.minlength),
          maxLength: num(el.attributes.maxlength),
          min: num(el.attributes.min),
          max: num(el.attributes.max),
        },
        options: kind === 'select' ? selectOptions(el, elements, byId) : [],
        property: p.name,
        elementIds: [el.id],
      })
    }

    const isSearchField = (p: FormParam) => {
      const el = byId.get(p.elementIds[0]!)!
      return p.kind === 'search' || /search/i.test(`${el.accessibleName} ${el.attributes.name} ${el.attributes.placeholder}`)
    }
    const kind: FormSpec['kind'] = params.some((p) => p.kind === 'password')
      ? 'login'
      : params.length === 1 && isSearchField(params[0]!) ? 'search' : 'form'

    // Readable parameter names from the property names (emailInput → email).
    const finalNames = createNameRegistry()
    for (const p of params) {
      if (p.kind === 'radio') p.name = finalNames(p.name)
      else p.name = kind === 'search' ? finalNames('query') : paramName(p.property!, finalNames)
    }

    const formWords = words(form?.accessibleName ?? form?.attributes.id ?? form?.attributes.name ?? '').filter((w) => !/^form$/i.test(w))
    const base = kind === 'login' ? 'login' : kind === 'search' ? 'search' : camelCase(['submit', ...formWords.slice(0, 3), 'form'])
    const ownMessages = props.filter((p) => isMessage(byId.get(p.elementId)!))
    // A message inside the form, or the page's only message when this is the only form.
    const message = ownMessages[0] ?? (pageMessages.length === 1 && form !== null ? pageMessages[0] : undefined)
    specs.push({
      method: nameFor(base),
      title: kind === 'login' ? 'Login' : kind === 'search' ? 'Search' : form?.accessibleName ?? 'Form',
      params,
      submit: submits[0]!.name,
      message: message?.name,
      kind,
    })
  }
  return specs
}
