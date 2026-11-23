// User-facing locators: getByTestId, getByRole, getByLabel, getByPlaceholder,
// getByAltText, getByTitle, getByText. Each strategy returns nothing unless the
// scanned element carries enough real information to justify it.
import { NAME_SOURCE_LABEL, SCAN_LIMITS, TEST_ID_ATTRIBUTES } from '../../../shared/constants'
import type { AccessibleNameSource, ScannedElement } from '../../../shared/types'
import type { Candidate, Strategy } from '../types'
import { cssString, pageCall } from '../utils/escaping'
import { assessText, assessValue } from '../utils/stability'

/** Text longer than this is not used for matching: long copy is volatile and noisy. */
export const MAX_MATCH_TEXT = 80

/** The scanner truncates long values to exactly `limit` chars ending in "…". */
export function isTruncated(value: string, limit: number): boolean {
  return value.length >= limit && value.endsWith('…')
}

/** A complete, reasonably short value usable in a text/name matcher. */
export function matchText(value: string | undefined, limit: number): string | undefined {
  const v = value?.trim()
  if (!v || isTruncated(v, limit) || v.length > MAX_MATCH_TEXT) return undefined
  return v
}

/** An attribute value that was captured in full (not truncated, not blank). */
export function attrValue(el: ScannedElement, name: string): string | undefined {
  const raw = el.attributes[name]
  if (raw === undefined || !raw.trim() || isTruncated(raw, SCAN_LIMITS.maxAttributeLength)) return undefined
  return raw
}

const hasWordChars = (text: string) => /[\p{L}\p{N}]/u.test(text)

/** Roles accepted by Playwright's getByRole(). */
const ARIA_ROLES = new Set([
  'alert', 'alertdialog', 'application', 'article', 'banner', 'blockquote', 'button', 'caption', 'cell',
  'checkbox', 'code', 'columnheader', 'combobox', 'complementary', 'contentinfo', 'definition', 'deletion',
  'dialog', 'directory', 'document', 'emphasis', 'feed', 'figure', 'form', 'generic', 'grid', 'gridcell',
  'group', 'heading', 'img', 'insertion', 'link', 'list', 'listbox', 'listitem', 'log', 'main', 'marquee',
  'math', 'meter', 'menu', 'menubar', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'navigation', 'none',
  'note', 'option', 'paragraph', 'presentation', 'progressbar', 'radio', 'radiogroup', 'region', 'row',
  'rowgroup', 'rowheader', 'scrollbar', 'search', 'searchbox', 'separator', 'slider', 'spinbutton', 'status',
  'strong', 'subscript', 'superscript', 'switch', 'tab', 'table', 'tablist', 'tabpanel', 'term', 'textbox',
  'time', 'timer', 'toolbar', 'tooltip', 'tree', 'treegrid', 'treeitem',
])
const UNLOCATABLE_ROLES = new Set(['presentation', 'none', 'generic'])
/** Landmarks are meaningful without a name; other roles are not. */
const LANDMARK_ROLES = new Set(['main', 'banner', 'contentinfo', 'navigation', 'search', 'complementary'])

const LABELABLE_TAGS = new Set(['input', 'select', 'textarea', 'meter', 'progress', 'output'])
const LABELABLE_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'listbox', 'checkbox', 'radio', 'switch', 'slider', 'spinbutton'])
const LABEL_SOURCES = new Set<AccessibleNameSource>(['label', 'aria-label', 'aria-labelledby'])

/** Visibility reasons that remove an element from the accessibility tree. */
const NOT_IN_A11Y_TREE = new Set(['display-none', 'hidden-attribute', 'ancestor-not-rendered', 'visibility-hidden'])

function candidate(c: Omit<Candidate, 'notes'> & { notes?: string[] }): Candidate {
  return { notes: [], ...c }
}

function headingLevel(el: ScannedElement): number | undefined {
  if (el.role !== 'heading') return undefined
  const tag = /^h([1-6])$/.exec(el.tagName)
  if (tag) return Number(tag[1])
  const aria = Number(el.attributes['aria-level'])
  return Number.isInteger(aria) && aria > 0 ? aria : undefined
}

export const testIdStrategy: Strategy = (el, ctx) => {
  const configured = ctx.options.testIdAttribute
  const out: Candidate[] = []
  for (const attr of TEST_ID_ATTRIBUTES) {
    const value = attrValue(el, attr)
    if (!value || value !== value.trim()) continue // test ids match exactly; padded values are suspicious
    const { level, reasons } = assessValue('stable', `Explicit test hook (${attr}) added for automation`, value)
    if (attr === configured) {
      out.push(candidate({
        key: `testid:${attr}`, strategy: 'testid', rank: 10,
        expression: pageCall('getByTestId', value),
        query: { kind: 'testid', attribute: attr, value },
        displayValue: `testid "${value}"`,
        stability: level, stabilityReasons: reasons, sourceAttributes: [attr],
      }))
    } else {
      // getByTestId() only reads the configured attribute, so other hooks are written as CSS.
      out.push(candidate({
        key: `testid:${attr}`, strategy: 'testid', rank: 11,
        expression: pageCall('locator', `[${attr}=${cssString(value)}]`),
        query: { kind: 'css', selector: `[${attr}=${cssString(value)}]` },
        displayValue: `[${attr}="${value}"]`,
        stability: level, stabilityReasons: reasons, sourceAttributes: [attr],
        notes: [
          `Written as CSS because getByTestId() reads ${configured}. To use getByTestId(), set testIdAttribute to '${attr}' in playwright.config and in Locator Studio settings.`,
        ],
      }))
    }
  }
  return out
}

export const roleStrategy: Strategy = (el) => {
  const role = el.role
  if (!role || !ARIA_ROLES.has(role) || UNLOCATABLE_ROLES.has(role)) return []
  if (el.attributes['aria-hidden'] === 'true') return [] // excluded from the accessibility tree
  const roleSource = el.roleSource === 'explicit' ? 'role' : `<${el.tagName}> implicit role`
  const notes = NOT_IN_A11Y_TREE.has(el.visibilityReason)
    ? ['Hidden when scanned: getByRole() only matches it while it is rendered (or with includeHidden: true).']
    : []

  const name = matchText(el.accessibleName, SCAN_LIMITS.maxNameLength)
  if (!name) {
    // Unnamed (or long-named) non-landmarks would match every element with that role.
    if (!LANDMARK_ROLES.has(role) || el.accessibleName) return []
    return [candidate({
      key: 'role', strategy: 'role', rank: 75,
      expression: pageCall('getByRole', role),
      query: { kind: 'role', role },
      displayValue: `role=${role}`,
      stability: 'moderate',
      stabilityReasons: ['Landmark role without an accessible name: survives content changes, but adding another such landmark changes what it matches'],
      sourceAttributes: [roleSource], notes,
    })]
  }

  const source = el.accessibleNameSource
  const fromHint = source === 'title' || source === 'placeholder'
  const { level, reasons } = assessText(
    fromHint ? 'moderate' : 'stable',
    fromHint
      ? `Accessible name comes from the ${source} attribute, which is reworded more often than labels`
      : 'Semantic role and accessible name: what users and assistive technology perceive',
    name,
  )
  const headingLvl = headingLevel(el)
  return [candidate({
    key: 'role', strategy: 'role', rank: 20,
    expression: pageCall('getByRole', role, { name, level: headingLvl }),
    query: { kind: 'role', role, name, level: headingLvl },
    displayValue: `${role} "${name}"${headingLvl ? ` (level ${headingLvl})` : ''}`,
    stability: level, stabilityReasons: reasons,
    sourceAttributes: [roleSource, source ? NAME_SOURCE_LABEL[source] : 'accessible name'],
    notes,
  })]
}

export const labelStrategy: Strategy = (el) => {
  const source = el.accessibleNameSource
  if (!source || !LABEL_SOURCES.has(source)) return [] // never from nearby or placeholder text
  if (!LABELABLE_TAGS.has(el.tagName) && !(el.role && LABELABLE_ROLES.has(el.role))) return []
  const name = matchText(el.accessibleName, SCAN_LIMITS.maxNameLength)
  if (!name || !hasWordChars(name)) return []
  const reason =
    source === 'label'
      ? 'Associated <label> text: visible and tied to the control'
      : source === 'aria-label'
        ? 'aria-label: a deliberate accessible label'
        : 'Labelled by another element (aria-labelledby)'
  const { level, reasons } = assessText('stable', reason, name)
  return [candidate({
    key: 'label', strategy: 'label', rank: 30,
    expression: pageCall('getByLabel', name),
    query: { kind: 'label', text: name },
    displayValue: `label "${name}"`,
    stability: level, stabilityReasons: reasons, sourceAttributes: [NAME_SOURCE_LABEL[source]],
  })]
}

export const placeholderStrategy: Strategy = (el) => {
  const value = matchText(attrValue(el, 'placeholder'), SCAN_LIMITS.maxAttributeLength)
  if (!value || !hasWordChars(value)) return []
  const { level, reasons } = assessText('moderate', 'Placeholder hint text is reworded more often than labels', value)
  return [candidate({
    key: 'placeholder', strategy: 'placeholder', rank: 40,
    expression: pageCall('getByPlaceholder', value),
    query: { kind: 'placeholder', text: value },
    displayValue: `placeholder "${value}"`,
    stability: level, stabilityReasons: reasons, sourceAttributes: ['placeholder'],
  })]
}

const IMAGE_FILE = /\.(png|jpe?g|gif|svg|webp|avif|bmp|ico)$/i
const GENERIC_ALT = /^(image|img|photo|picture|icon|graphic|banner|spacer|untitled|null|undefined)$/i

export const altTextStrategy: Strategy = (el) => {
  if (!['img', 'area', 'input'].includes(el.tagName)) return []
  const value = matchText(attrValue(el, 'alt'), SCAN_LIMITS.maxAttributeLength)
  if (!value || !hasWordChars(value) || IMAGE_FILE.test(value) || GENERIC_ALT.test(value)) return []
  const { level, reasons } = assessText('stable', 'Alternative text describes the image and changes with it', value)
  return [candidate({
    key: 'alttext', strategy: 'alttext', rank: 50,
    expression: pageCall('getByAltText', value),
    query: { kind: 'alttext', text: value },
    displayValue: `alt "${value}"`,
    stability: level, stabilityReasons: reasons, sourceAttributes: ['alt'],
  })]
}

export const titleStrategy: Strategy = (el) => {
  const value = matchText(attrValue(el, 'title'), SCAN_LIMITS.maxAttributeLength)
  if (!value || !hasWordChars(value)) return []
  const { level, reasons } = assessText('stable', 'title attribute (tooltip text) set by the author', value)
  return [candidate({
    key: 'title', strategy: 'title', rank: 60,
    expression: pageCall('getByTitle', value),
    query: { kind: 'title', text: value },
    displayValue: `title "${value}"`,
    stability: level, stabilityReasons: reasons, sourceAttributes: ['title'],
  })]
}

/** Elements whose visible text is not what users read as their content. */
const NO_TEXT_LOCATOR = new Set(['input', 'select', 'textarea', 'option', 'optgroup'])

export const textStrategy: Strategy = (el) => {
  if (NO_TEXT_LOCATOR.has(el.tagName)) return []
  // Text content, not the accessible name: getByText matches what is rendered.
  const text = matchText(el.textContent, SCAN_LIMITS.maxTextLength)
  if (!text || !hasWordChars(text)) return []
  const { level, reasons } = assessText('moderate', 'Visible text changes with copy edits and translations', text)
  return [candidate({
    key: 'text', strategy: 'text', rank: 80,
    expression: pageCall('getByText', text),
    query: { kind: 'text', text },
    displayValue: `text "${text}"`,
    stability: level, stabilityReasons: reasons, sourceAttributes: ['text content'],
  })]
}
