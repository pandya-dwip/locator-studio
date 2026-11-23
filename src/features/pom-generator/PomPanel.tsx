import { useMemo, useState } from 'react'
import { Check, Copy, Download, LoaderCircle, ShieldCheck } from 'lucide-react'
import {
  defaultClassName,
  elementLabel,
  generatePom,
  isPomEligible,
  type ModuleFormat,
} from '../../generators/playwright'
import { useSettings } from '../../shared/hooks'
import type { OutputLanguage, ScanResult } from '../../shared/types'
import { errorMessage } from '../../shared/utils'
import { updateSettings } from '../../storage'
import type { LocatorState } from '../explorer/useLocators'
import type { ValidationState } from '../explorer/useValidation'
import './pom.css'

/** Generator options that live with the explorer (they survive switching views). */
export interface PomForm {
  scope: 'selected' | 'eligible'
  /** Empty means "use the default derived from the page". */
  className: string
  moduleFormat: ModuleFormat
  includeMethods: boolean
  allowUnvalidated: boolean
  propertyNames: Record<string, string>
  /** User edits to the code, and the generated code they were based on. */
  edited: { code: string; base: string } | null
}

export const initialPomForm: PomForm = {
  scope: 'eligible',
  className: '',
  moduleFormat: 'commonjs',
  includeMethods: true,
  allowUnvalidated: false,
  propertyNames: {},
  edited: null,
}

interface Props {
  scan: ScanResult
  locators: LocatorState
  validation: ValidationState
  picked: Set<string>
  form: PomForm
  onFormChange: (update: (form: PomForm) => PomForm) => void
}

export function PomPanel({ scan, locators, validation, picked, form, onFormChange }: Props) {
  const { language } = useSettings()
  const set = (patch: Partial<PomForm>) => onFormChange((f) => ({ ...f, ...patch }))
  const [copied, setCopied] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const fallbackClass = useMemo(() => defaultClassName(scan.title, scan.url), [scan])
  const eligibleIds = useMemo(() => scan.elements.filter(isPomEligible).map((e) => e.id), [scan])
  const scopeIds = form.scope === 'selected' ? scan.elements.filter((e) => picked.has(e.id)).map((e) => e.id) : eligibleIds

  const pom = useMemo(
    () =>
      locators.results
        ? generatePom({
            scan,
            elementIds: scopeIds,
            locators: locators.results,
            validationOf: validation.resultFor,
            options: {
              language,
              moduleFormat: form.moduleFormat,
              className: form.className || fallbackClass,
              includeMethods: form.includeMethods,
              allowUnvalidated: form.allowUnvalidated,
              propertyNames: form.propertyNames,
            },
          })
        : null,
    // scopeIds derives from scan, picked and form.scope, which are all dependencies.
    [scan, locators.results, validation.resultFor, language, form, fallbackClass, picked, eligibleIds],
  )

  if (!pom) {
    return (
      <div className="pom">
        <p className="muted loc-pending">
          <LoaderCircle size={14} className="spin" /> Generating locators…
        </p>
      </div>
    )
  }

  const code = form.edited?.code ?? pom.code
  const outdated = form.edited !== null && form.edited.base !== pom.code
  const validatedInScope = scopeIds.filter((id) => locators.results?.get(id)?.locators.some((l) => validation.resultFor(l))).length
  const unvalidatedIncluded = pom.properties.filter((p) => !p.validated).length

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (err) {
      setActionError(`Copy failed: ${errorMessage(err)}`)
    }
  }

  function download() {
    // Local download from an extension page: no permission, no network.
    const url = URL.createObjectURL(new Blob([code], { type: 'text/plain;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = pom!.fileName
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div className="pom">
      <header className="pom-header">
        <h2>Page Object</h2>
        <p className="muted">
          Generated from validated locators. Tick elements in the list to build a Page Object from a selection.
        </p>
      </header>

      <div className="pom-options">
        <Field label="Language">
          <Segmented
            value={language}
            options={[
              ['typescript', 'TypeScript'],
              ['javascript', 'JavaScript'],
            ]}
            onChange={(v) => void updateSettings({ language: v as OutputLanguage })}
          />
        </Field>
        {language === 'javascript' && (
          <Field label="Module">
            <Segmented
              value={form.moduleFormat}
              options={[
                ['commonjs', 'CommonJS'],
                ['esm', 'ES module'],
              ]}
              onChange={(v) => set({ moduleFormat: v as ModuleFormat })}
            />
          </Field>
        )}
        <Field label="Class name">
          <input
            className="input"
            value={form.className}
            placeholder={fallbackClass}
            onChange={(e) => set({ className: e.target.value })}
            spellCheck={false}
          />
        </Field>
        <Field label="Elements">
          <Segmented
            value={form.scope}
            options={[
              ['eligible', `All eligible (${eligibleIds.length})`],
              ['selected', `Selected (${picked.size})`],
            ]}
            onChange={(v) => set({ scope: v as PomForm['scope'] })}
          />
        </Field>
        <label className="check">
          <input type="checkbox" checked={form.includeMethods} onChange={(e) => set({ includeMethods: e.target.checked })} />
          Reusable methods
        </label>
        <label className="check" title="Use a never-validated candidate when no validated one exists. Marked in the code.">
          <input type="checkbox" checked={form.allowUnvalidated} onChange={(e) => set({ allowUnvalidated: e.target.checked })} />
          Include unvalidated locators
        </label>
      </div>

      <div className="pom-status">
        <p>
          <strong>{pom.properties.length}</strong> included
          {unvalidatedIncluded > 0 && <span className="text-warn"> ({unvalidatedIncluded} unvalidated)</span>} ·{' '}
          <strong>{pom.excluded.length}</strong> excluded · {validatedInScope} of {scopeIds.length} elements validated
          {pom.methods.length > 0 && ` · methods: ${pom.methods.join(', ')}`}
        </p>
        {validation.running ? (
          <span className="muted loc-pending">
            <LoaderCircle size={14} className="spin" /> Validating {validation.running.done}/{validation.running.total}
          </span>
        ) : (
          <button
            className={validatedInScope < scopeIds.length ? 'btn btn-primary' : 'btn'}
            onClick={() => void validation.validateElements(scopeIds)}
            disabled={scopeIds.length === 0}
          >
            <ShieldCheck size={14} /> {validatedInScope > 0 ? 'Revalidate' : 'Validate'} {scopeIds.length} elements
          </button>
        )}
      </div>
      {validation.error && <p className="error" role="alert">Validation failed: {validation.error}</p>}
      {form.scope === 'selected' && picked.size === 0 && (
        <p className="muted pom-hint">No elements selected. Tick elements in the list, or switch to All eligible.</p>
      )}

      <div className="pom-editor">
        <div className="pom-editor-bar">
          <code>{pom.fileName}</code>
          {form.edited && <span className="badge">Edited</span>}
          <span className="spacer" />
          {form.edited && (
            <button type="button" className="link-btn" onClick={() => set({ edited: null })}>
              Discard edits
            </button>
          )}
          <button type="button" className="btn" onClick={copy}>
            {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
          </button>
          <button type="button" className="btn" onClick={download}>
            <Download size={14} /> Download
          </button>
        </div>
        {outdated && (
          <p className="pom-outdated">
            Options or validation changed since you edited the code.{' '}
            <button type="button" className="link-btn" onClick={() => set({ edited: null })}>
              Replace with regenerated code
            </button>
          </p>
        )}
        {actionError && <p className="error" role="alert">{actionError}</p>}
        <textarea
          className="pom-code"
          value={code}
          onChange={(e) => set({ edited: { code: e.target.value, base: form.edited?.base ?? pom.code } })}
          onKeyDown={insertSpacesOnTab}
          spellCheck={false}
          wrap="off"
          aria-label="Generated Page Object code (editable)"
        />
      </div>

      {pom.properties.length > 0 && (
        <details className="pom-list">
          <summary>Included elements ({pom.properties.length}) and property names</summary>
          <table>
            <tbody>
              {pom.properties.map((p) => {
                const el = scan.elements.find((e) => e.id === p.elementId)!
                return (
                  <tr key={p.elementId}>
                    <td>
                      <input
                        className="input input-mono"
                        value={form.propertyNames[p.elementId] ?? p.name}
                        onChange={(e) => set({ propertyNames: { ...form.propertyNames, [p.elementId]: e.target.value } })}
                        aria-label={`Property name for ${elementLabel(el)}`}
                        spellCheck={false}
                      />
                    </td>
                    <td className="truncate">{elementLabel(el)}</td>
                    <td><code className="truncate">{p.locator.displayValue}</code></td>
                    <td>{p.validated ? <span className="val-badge" data-tone="ok">Validated</span> : <span className="val-badge" data-tone="warn">Unvalidated</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </details>
      )}

      {pom.excluded.length > 0 && (
        <details className="pom-list">
          <summary>Excluded elements ({pom.excluded.length})</summary>
          <ul>
            {pom.excluded.map((x) => (
              <li key={x.elementId}>
                <span className="truncate">{x.label}</span>
                <span className="muted">{x.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

/** Tab inserts two spaces instead of leaving the editor. */
function insertSpacesOnTab(e: React.KeyboardEvent<HTMLTextAreaElement>) {
  if (e.key !== 'Tab' || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return
  e.preventDefault()
  const t = e.currentTarget
  t.setRangeText('  ', t.selectionStart, t.selectionEnd, 'end')
  t.dispatchEvent(new Event('input', { bubbles: true }))
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="pom-field">
      <span className="pom-field-label">{label}</span>
      {children}
    </div>
  )
}

function Segmented({ value, options, onChange }: { value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map(([v, label]) => (
        <label key={v}>
          <input type="radio" checked={value === v} onChange={() => onChange(v)} />
          {label}
        </label>
      ))}
    </div>
  )
}
