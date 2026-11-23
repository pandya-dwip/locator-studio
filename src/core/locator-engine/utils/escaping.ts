// Escaping for every literal that ends up in a generated expression. Locator
// code is always assembled from these helpers, never by raw concatenation of
// page-derived strings.

function hex(code: number, width: number): string {
  return code.toString(16).padStart(width, '0')
}

/** A single-quoted JavaScript string literal that evaluates to exactly `value`. */
export function jsString(value: string): string {
  let out = "'"
  for (const ch of value) {
    const code = ch.codePointAt(0)!
    if (ch === '\\') out += '\\\\'
    else if (ch === "'") out += "\\'"
    else if (ch === '\n') out += '\\n'
    else if (ch === '\r') out += '\\r'
    else if (ch === '\t') out += '\\t'
    else if (code < 0x20 || code === 0x7f) out += `\\x${hex(code, 2)}`
    // Line/paragraph separators and lone surrogates are escaped to keep the literal portable.
    else if (code === 0x2028 || code === 0x2029 || (code >= 0xd800 && code <= 0xdfff)) out += `\\u${hex(code, 4)}`
    else out += ch
  }
  return `${out}'`
}

/** CSS identifier escaping (CSSOM `CSS.escape`), for #ids, .classes and tag names. */
export function cssIdent(value: string): string {
  let out = ''
  const first = value.charCodeAt(0)
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i)
    if (c === 0) out += '�'
    else if (
      (c >= 0x01 && c <= 0x1f) ||
      c === 0x7f ||
      (i === 0 && c >= 0x30 && c <= 0x39) ||
      (i === 1 && c >= 0x30 && c <= 0x39 && first === 0x2d)
    ) {
      out += `\\${c.toString(16)} `
    } else if (i === 0 && value.length === 1 && c === 0x2d) out += `\\${value[i]}`
    else if (
      c >= 0x80 ||
      c === 0x2d ||
      c === 0x5f ||
      (c >= 0x30 && c <= 0x39) ||
      (c >= 0x41 && c <= 0x5a) ||
      (c >= 0x61 && c <= 0x7a)
    ) {
      out += value[i]
    } else out += `\\${value[i]}`
  }
  return out
}

/** A double-quoted CSS string, for attribute selector values. */
export function cssString(value: string): string {
  let out = '"'
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i)
    if (c === 0) out += '�'
    else if ((c >= 0x01 && c <= 0x1f) || c === 0x7f) out += `\\${c.toString(16)} `
    else if (c === 0x22 || c === 0x5c) out += `\\${value[i]}`
    else out += value[i]
  }
  return `${out}"`
}

/** An XPath 1.0 string literal. XPath has no escapes, so mixed quotes need concat(). */
export function xpathString(value: string): string {
  if (!value.includes('"')) return `"${value}"`
  if (!value.includes("'")) return `'${value}'`
  return `concat(${value
    .split('"')
    .map((part) => `"${part}"`)
    .join(`, '"', `)})`
}

type OptionValue = string | number | boolean | undefined

/** `{ name: 'Save', level: 2 }`. String values are escaped; undefined entries are dropped. */
export function objectLiteral(entries: Record<string, OptionValue>): string | undefined {
  const parts = Object.entries(entries)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? jsString(v) : String(v)}`)
  return parts.length ? `{ ${parts.join(', ')} }` : undefined
}

/** `page.<method>(<args>)` with every string argument escaped. */
export function pageCall(method: string, value: string, options?: Record<string, OptionValue>): string {
  const opts = options && objectLiteral(options)
  return `page.${method}(${jsString(value)}${opts ? `, ${opts}` : ''})`
}
