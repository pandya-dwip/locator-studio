import { useEffect, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { errorMessage } from '../utils'

/**
 * Read-only code with a Copy button. Preserves formatting and scrolls
 * horizontally instead of squeezing long lines. Used for locators now and
 * for generated POM code later.
 */
export function CodeBlock({ code, compact }: { code: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setCopied(false)
    setError(null)
  }, [code])

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <div className={`code-block${compact ? ' code-block-compact' : ''}`}>
      <pre tabIndex={0}>
        <code>{code}</code>
      </pre>
      <button type="button" className="code-copy" onClick={copy} aria-label={copied ? 'Copied' : 'Copy code'} title="Copy">
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      {error && <p className="error code-error" role="alert">Copy failed: {error}</p>}
    </div>
  )
}
