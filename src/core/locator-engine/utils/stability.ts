// Stability heuristics: how likely a value is to survive page changes.
// These never say anything about uniqueness.
import type { StabilityLevel } from '../../../shared/types'

export interface Assessment {
  level: StabilityLevel
  reasons: string[]
}

const ORDER: StabilityLevel[] = ['stable', 'moderate', 'unstable']

export function downgrade(level: StabilityLevel): StabilityLevel {
  const i = ORDER.indexOf(level)
  return i < 0 ? level : ORDER[Math.min(i + 1, ORDER.length - 1)]!
}

export const STABILITY_RANK: Record<StabilityLevel, number> = { stable: 0, moderate: 1, unstable: 2, unknown: 3 }

/** Counts transitions between letters and digits: "a8f3k2" → 5, "item42" → 1. */
function letterDigitTransitions(token: string): number {
  let n = 0
  for (let i = 1; i < token.length; i++) {
    if (/\d/.test(token[i - 1]!) !== /\d/.test(token[i]!)) n++
  }
  return n
}

/** "bdVaJa", "kpDqfY": mixed case without readable lowercase runs (styled-components style). */
function looksRandomCase(token: string): boolean {
  if (!/^[a-zA-Z]{5,10}$/.test(token)) return false
  const uppers = token.replace(/[^A-Z]/g, '').length
  const longestLowerRun = Math.max(...token.split(/[A-Z]+/).map((s) => s.length))
  return uppers >= 2 && longestLowerRun <= 2
}

/**
 * Why a value (id, class, test id, attribute) looks machine-generated, or null.
 * Generated values typically change between builds, sessions or renders.
 */
export function generatedReason(value: string): string | null {
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(value)) return 'contains a UUID'
  if (/^(:|«)[\w-]+(:|»)$/.test(value)) return 'is a framework-generated id (React useId)'
  if (/^(ember|ext-gen|ext-comp|yui_|gwt-|mui-|radix-|headlessui-|react-aria|rc-|downshift-|select2-)[\w-]*\d/i.test(value)) {
    return 'uses a UI framework’s auto-generated prefix'
  }
  if (/^(css|sc|jsx|emotion|svelte|astro|styled)-[\w-]+$/i.test(value)) return 'looks like a CSS-in-JS generated name'
  if (/\d{4,}/.test(value)) return 'contains a long number'
  for (const token of value.split(/[-_:.]+/)) {
    if (token.length >= 5 && letterDigitTransitions(token) >= 3) return 'contains a hash-like segment'
    if (looksRandomCase(token)) return 'contains a randomly cased segment'
  }
  return null
}

/** Reasons user-visible text may change. */
export function textConcerns(text: string): string[] {
  const concerns: string[] = []
  if (/\d/.test(text)) concerns.push('Contains numbers, which often change (counts, prices, dates)')
  if (text.length > 40) concerns.push('Long text is more likely to be reworded')
  if (!/[\p{L}\p{N}]/u.test(text)) concerns.push('Has no letters or digits (icon or symbol)')
  return concerns
}

/** Applies text concerns: any concern lowers the level by one step. */
export function assessText(level: StabilityLevel, reason: string, text: string): Assessment {
  const concerns = textConcerns(text)
  return { level: concerns.length ? downgrade(level) : level, reasons: [reason, ...concerns] }
}

/**
 * Assessment for an attribute value: generated-looking values are unstable,
 * values with embedded numbers drop one level.
 */
export function assessValue(level: StabilityLevel, reason: string, value: string): Assessment {
  const generated = generatedReason(value)
  if (generated) return { level: 'unstable', reasons: [reason, `Value ${generated}`] }
  if (/\d/.test(value)) return { level: downgrade(level), reasons: [reason, 'Value contains numbers that may be generated'] }
  return { level, reasons: [reason] }
}
