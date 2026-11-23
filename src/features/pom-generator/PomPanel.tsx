import { useMemo } from 'react'
import { Files, FlaskConical, ListChecks, LoaderCircle, ShieldCheck } from 'lucide-react'
import {
  defaultClassName,
  elementLabel,
  generatePackage,
  isPomEligible,
  type FileRole,
  type ModuleFormat,
} from '../../generators/playwright'
import { useSettings } from '../../shared/hooks'
import { findNoise } from '../../shared/relevance'
import type { OutputLanguage, ScanResult } from '../../shared/types'
import { updateSettings } from '../../storage'
import type { LocatorState } from '../explorer/useLocators'
import { DISCONNECTED_HELP, type ValidationState } from '../explorer/useValidation'
import { FileExplorer, type EditedFiles } from './FileExplorer'
import { TestDataEditor } from './TestDataEditor'
import { useTestData } from './useTestData'
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
  section: 'files' | 'data' | 'elements'
  file: FileRole
  /** User edits per generated file, and the generated code they were based on. */
  edited: EditedFiles
}

export const initialPomForm: PomForm = {
  scope: 'eligible',
  className: '',
  moduleFormat: 'commonjs',
  includeMethods: true,
  allowUnvalidated: false,
  propertyNames: {},
  section: 'files',
  file: 'page',
  edited: {},
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
  const testData = useTestData(scan.url)
  const set = (patch: Partial<PomForm>) => onFormChange((f) => ({ ...f, ...patch }))

  const fallbackClass = useMemo(() => defaultClassName(scan.title, scan.url), [scan])
  // "All eligible" skips the same noise the explorer hides (hidden duplicates, wrappers, icons).
  const eligibleIds = useMemo(() => {
    const noise = findNoise(scan.elements)
    return scan.elements.filter((e) => isPomEligible(e) && !noise.has(e.id)).map((e) => e.id)
  }, [scan])
  const scopeIds = useMemo(
    () => (form.scope === 'selected' ? scan.elements.filter((e) => picked.has(e.id)).map((e) => e.id) : eligibleIds),
    [form.scope, scan, picked, eligibleIds],
  )

  // One package from the live validation results and the current test data.
  const pkg = useMemo(
    () =>
      locators.results && testData.loaded
        ? generatePackage({
            scan,
            elementIds: scopeIds,
            locators: locators.results,
            validationOf: validation.resultFor,
            testData: testData.data,
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
    [scan, scopeIds, locators.results, validation.resultFor, testData.loaded, testData.data, language, form, fallbackClass],
  )

  if (!pkg) {
    return (
      <div className="pom">
        <p className="muted loc-pending">
          <LoaderCircle size={14} className="spin" /> Preparing locators and test data…
        </p>
      </div>
    )
  }

  const disconnected = validation.connection === 'lost' || validation.connection === 'rescanned'
  const validatedInScope = scopeIds.filter((id) => locators.results?.get(id)?.locators.some((l) => validation.resultFor(l))).length
  const included = pkg.pom.properties.length
  const unvalidatedIncluded = pkg.pom.properties.filter((p) => !p.validated).length
  const cases = pkg.scenarios.reduce((n, r) => n + r.scenarios.length, 0)
  const validateButton = validation.running ? (
    <span className="muted loc-pending">
      <LoaderCircle size={14} className="spin" /> Validating {validation.running.done}/{validation.running.total}
    </span>
  ) : (
    <button
      className={validatedInScope < scopeIds.length ? 'btn btn-primary' : 'btn'}
      onClick={() => void validation.validateElements(scopeIds)}
      disabled={scopeIds.length === 0 || disconnected}
    >
      <ShieldCheck size={14} /> {validatedInScope > 0 ? 'Revalidate' : 'Validate'} {scopeIds.length} elements
    </button>
  )

  return (
    <div className="pom">
      <header className="pom-config">
        <label className="pom-field pom-class">
          <span>Class</span>
          <input className="input" value={form.className} placeholder={fallbackClass} onChange={(e) => set({ className: e.target.value })} spellCheck={false} />
        </label>
        <Segmented
          label="Language"
          value={language}
          options={[
            ['typescript', 'TypeScript'],
            ['javascript', 'JavaScript'],
          ]}
          onChange={(v) => void updateSettings({ language: v as OutputLanguage })}
        />
        {language === 'javascript' && (
          <Segmented
            label="Modules"
            value={form.moduleFormat}
            options={[
              ['commonjs', 'CommonJS'],
              ['esm', 'ES modules'],
            ]}
            onChange={(v) => set({ moduleFormat: v as ModuleFormat })}
          />
        )}
        <Segmented
          label="Elements"
          value={form.scope}
          options={[
            ['eligible', `All eligible (${eligibleIds.length})`],
            ['selected', `Selected (${picked.size})`],
          ]}
          onChange={(v) => set({ scope: v as PomForm['scope'] })}
        />
        <label className="check">
          <input type="checkbox" checked={form.includeMethods} onChange={(e) => set({ includeMethods: e.target.checked })} />
          Form methods
        </label>
        <label className="check" title="Use never-validated candidates when no validated one exists. They are marked in the code.">
          <input type="checkbox" checked={form.allowUnvalidated} onChange={(e) => set({ allowUnvalidated: e.target.checked })} />
          Include unvalidated
        </label>
      </header>

      <div className="pom-status">
        <p>
          <strong>{included}</strong> locators
          {unvalidatedIncluded > 0 && <span className="text-warn"> ({unvalidatedIncluded} unvalidated)</span>} ·{' '}
          <strong>{pkg.pom.excluded.length}</strong> excluded · {validatedInScope}/{scopeIds.length} elements validated ·{' '}
          {pkg.pom.forms.length} form{pkg.pom.forms.length === 1 ? '' : 's'} · {cases} test case{cases === 1 ? '' : 's'}
        </p>
        {validateButton}
      </div>
      {disconnected && (
        <p className="pom-alert">{DISCONNECTED_HELP[validation.connection as 'lost' | 'rescanned']} Until then you can turn on Include unvalidated.</p>
      )}
      {validation.error && !disconnected && <p className="error" role="alert">Validation failed: {validation.error}</p>}
      {pkg.warnings.length > 0 && !pkg.blocked && (
        <ul className="pom-warnings">
          {pkg.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      <nav className="pom-tabs" aria-label="Generator sections">
        <SectionTab active={form.section === 'files'} onClick={() => set({ section: 'files' })} icon={<Files size={14} />} label="Files" count={pkg.files.length} />
        <SectionTab active={form.section === 'data'} onClick={() => set({ section: 'data' })} icon={<FlaskConical size={14} />} label="Test data" count={cases} />
        <SectionTab
          active={form.section === 'elements'}
          onClick={() => set({ section: 'elements' })}
          icon={<ListChecks size={14} />}
          label="Elements"
          count={included}
          extra={pkg.pom.excluded.length ? `${pkg.pom.excluded.length} excluded` : undefined}
        />
      </nav>

      <div className="pom-body">
        {form.section === 'files' &&
          (pkg.blocked ? (
            <div className="pom-empty">
              <h3>Nothing to generate yet</h3>
              <p>{pkg.blocked}</p>
              <div className="pom-empty-actions">
                {validateButton}
                {!form.allowUnvalidated && (
                  <button type="button" className="btn" onClick={() => set({ allowUnvalidated: true })}>
                    Include unvalidated locators
                  </button>
                )}
                {form.scope === 'selected' && (
                  <button type="button" className="btn" onClick={() => set({ scope: 'eligible' })}>
                    Use all eligible elements
                  </button>
                )}
                <button type="button" className="btn" onClick={() => set({ section: 'elements' })}>
                  See excluded elements
                </button>
              </div>
            </div>
          ) : (
            <FileExplorer
              pkg={pkg}
              active={form.file}
              onSelect={(file) => set({ file })}
              edited={form.edited}
              onEdit={(role, value) => onFormChange((f) => ({ ...f, edited: { ...f.edited, [role]: value } }))}
            />
          ))}

        {form.section === 'data' && <TestDataEditor reports={pkg.scenarios} testData={testData} pageUrl={scan.url} baseName={pkg.baseName} />}

        {form.section === 'elements' && (
          <div className="pom-elements">
            <table className="pom-table">
              <thead>
                <tr>
                  <th>Property</th>
                  <th>Element</th>
                  <th>Locator</th>
                  <th>Validation</th>
                </tr>
              </thead>
              <tbody>
                {pkg.pom.properties.map((p) => {
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
                      <td>
                        <code className="pom-expr">{p.locator.expression}</code>
                      </td>
                      <td>
                        <span className="val-badge" data-tone={p.validated ? 'ok' : 'warn'}>
                          {p.validated ? 'Validated' : 'Unvalidated'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
                {pkg.pom.properties.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted">
                      No element has a usable locator yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {pkg.pom.excluded.length > 0 && (
              <>
                <h3 className="pom-subhead">Excluded ({pkg.pom.excluded.length})</h3>
                <ul className="pom-excluded">
                  {pkg.pom.excluded.map((x) => (
                    <li key={x.elementId}>
                      <span className="truncate">{x.label}</span>
                      <span className="muted">{x.reason}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function SectionTab(props: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; count: number; extra?: string }) {
  return (
    <button type="button" className="pom-tab" aria-pressed={props.active} onClick={props.onClick}>
      {props.icon} {props.label} <span className="kind-count">{props.count}</span>
      {props.extra && <span className="pom-tab-extra">{props.extra}</span>}
    </button>
  )
}

function Segmented({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div className="pom-field">
      <span>{label}</span>
      <div className="segmented" role="radiogroup" aria-label={label}>
        {options.map(([v, text]) => (
          <label key={v}>
            <input type="radio" checked={value === v} onChange={() => onChange(v)} />
            {text}
          </label>
        ))}
      </div>
    </div>
  )
}
