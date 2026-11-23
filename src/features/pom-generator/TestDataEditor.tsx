import { useRef, useState } from 'react'
import { Copy, Download, Plus, RotateCcw, Trash, Upload } from 'lucide-react'
import type { FormParam, ScenarioReport } from '../../generators/playwright'
import type { PageTestData, TestScenario } from '../../shared/types'
import { errorMessage } from '../../shared/utils'
import { downloadText } from './download'
import type { TestDataState } from './useTestData'

interface Props {
  reports: ScenarioReport[]
  testData: TestDataState
  pageUrl: string
  baseName: string
}

const newId = () => `case-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

/** Editable test cases per detected form. Every change regenerates the data and spec files. */
export function TestDataEditor({ reports, testData, pageUrl, baseName }: Props) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [notice, setNotice] = useState<string | null>(null)

  if (reports.length === 0) {
    return (
      <div className="pom-empty">
        <h3>No form to test</h3>
        <p className="muted">
          Test data is for forms: fillable fields plus one submit button among the included elements. Include the form's
          fields and its submit button (and make sure their locators are validated), or turn on Reusable form methods.
        </p>
      </div>
    )
  }

  function exportJson() {
    const forms = Object.fromEntries(reports.map((r) => [r.form.method, r.scenarios]))
    downloadText(`${baseName}.testdata.json`, JSON.stringify({ version: 1, page: pageUrl, forms }, null, 2), 'application/json')
  }

  async function importJson(file: File) {
    try {
      const parsed = JSON.parse(await file.text()) as { forms?: Record<string, unknown> }
      if (!parsed || typeof parsed !== 'object' || typeof parsed.forms !== 'object' || !parsed.forms) {
        throw new Error('Expected { "forms": { "<method>": [ ...cases ] } }')
      }
      const next: PageTestData = { ...testData.data }
      const imported: string[] = []
      const ignored: string[] = []
      for (const [method, cases] of Object.entries(parsed.forms)) {
        const report = reports.find((r) => r.form.method === method)
        if (!report || !Array.isArray(cases)) {
          ignored.push(method)
          continue
        }
        next[method] = cases.map((c) => sanitize(c, report.form.params))
        imported.push(`${method} (${cases.length})`)
      }
      testData.replaceAll(next)
      setNotice(`Imported ${imported.join(', ') || 'nothing'}.${ignored.length ? ` Ignored unknown forms: ${ignored.join(', ')}.` : ''}`)
    } catch (err) {
      setNotice(`Import failed: ${errorMessage(err)}`)
    }
  }

  return (
    <div className="td">
      <div className="td-toolbar">
        <p className="muted">
          Cases are written to the test data file and run by the spec. Values starting with <code>YOUR_</code> are
          placeholders: those cases are skipped until you replace them. Stored only in this browser.
        </p>
        <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
          <Upload size={14} /> Import JSON
        </button>
        <button type="button" className="btn" onClick={exportJson}>
          <Download size={14} /> Export JSON
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void importJson(f)
            e.target.value = ''
          }}
        />
      </div>
      {notice && <p className="td-notice">{notice}</p>}
      {testData.error && <p className="error">{testData.error}</p>}
      {reports.map((r) => (
        <FormCases key={r.form.method} report={r} testData={testData} />
      ))}
    </div>
  )
}

function FormCases({ report, testData }: { report: ScenarioReport; testData: TestDataState }) {
  const { form, scenarios, issues } = report
  const ready = scenarios.filter((s) => issues[s.id]!.length === 0).length
  const save = (next: TestScenario[]) => testData.setForm(form.method, next)
  const update = (id: string, patch: Partial<TestScenario>) => save(scenarios.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  const setValue = (id: string, param: string, value: string | boolean) =>
    save(scenarios.map((s) => (s.id === id ? { ...s, values: { ...s.values, [param]: value } } : s)))

  const blank = (): TestScenario => ({
    id: newId(),
    name: 'New case',
    values: Object.fromEntries(form.params.map((p) => [p.name, p.type === 'boolean' ? false : ''])),
    expected: 'failure',
  })

  return (
    <section className="td-form">
      <header className="td-form-head">
        <div>
          <h3>
            <code>
              {form.method}({form.params.map((p) => p.name).join(', ')})
            </code>
          </h3>
          <p className="muted">
            {scenarios.length} case{scenarios.length === 1 ? '' : 's'} · <span className="text-ok">{ready} ready</span>
            {scenarios.length - ready > 0 && <span className="text-warn"> · {scenarios.length - ready} need configuration</span>}
            {report.suggested && ' · suggested cases (edit them to make them yours)'}
            {!form.message && ' · no error message element found: failure cases need their expected text'}
          </p>
        </div>
        <button type="button" className="btn" onClick={() => save([...scenarios, blank()])}>
          <Plus size={14} /> Add case
        </button>
        {!report.suggested && (
          <button type="button" className="btn" onClick={() => testData.resetForm(form.method)} title="Replace your cases with the suggested ones">
            <RotateCcw size={14} /> Reset to suggestions
          </button>
        )}
      </header>

      <div className="td-table-wrap">
        <table className="td-table">
          <thead>
            <tr>
              <th>Case</th>
              {form.params.map((p) => (
                <th key={p.name}>
                  {p.name}
                  <span className="td-param">
                    {p.label} · {p.kind}
                    {p.required && ' · required'}
                    {p.constraints.maxLength !== undefined && ` · max ${p.constraints.maxLength}`}
                    {p.constraints.minLength !== undefined && ` · min ${p.constraints.minLength}`}
                  </span>
                </th>
              ))}
              <th>Expected</th>
              <th>Expected URL contains</th>
              <th>Expected text</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {scenarios.map((s) => {
              const problems = issues[s.id] ?? []
              return (
                <ScenarioRow
                  key={s.id}
                  scenario={s}
                  params={form.params}
                  problems={problems}
                  onName={(name) => update(s.id, { name })}
                  onValue={(param, value) => setValue(s.id, param, value)}
                  onExpected={(patch) => update(s.id, patch)}
                  onDuplicate={() => {
                    const i = scenarios.findIndex((x) => x.id === s.id)
                    save([...scenarios.slice(0, i + 1), { ...s, id: newId(), name: `${s.name} (copy)` }, ...scenarios.slice(i + 1)])
                  }}
                  onDelete={() => save(scenarios.filter((x) => x.id !== s.id))}
                />
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function ScenarioRow(props: {
  scenario: TestScenario
  params: FormParam[]
  problems: string[]
  onName: (v: string) => void
  onValue: (param: string, v: string | boolean) => void
  onExpected: (patch: Partial<TestScenario>) => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const s = props.scenario
  const cols = props.params.length + 5
  return (
    <>
      <tr className={props.problems.length ? 'td-row td-row-todo' : 'td-row'}>
        <td>
          <input className="input td-input" value={s.name} onChange={(e) => props.onName(e.target.value)} aria-label="Case name" />
        </td>
        {props.params.map((p) => (
          <td key={p.name}>
            <ValueInput param={p} value={s.values[p.name]} onChange={(v) => props.onValue(p.name, v)} />
          </td>
        ))}
        <td>
          <select
            className="select td-input"
            value={s.expected}
            onChange={(e) => props.onExpected({ expected: e.target.value as TestScenario['expected'] })}
            aria-label="Expected outcome"
          >
            <option value="success">Success</option>
            <option value="failure">Failure</option>
          </select>
        </td>
        <td>
          <input
            className="input td-input"
            value={s.expectedUrl ?? ''}
            placeholder={s.expected === 'success' ? '/dashboard' : ''}
            onChange={(e) => props.onExpected({ expectedUrl: e.target.value || undefined })}
            aria-label="Expected URL contains"
          />
        </td>
        <td>
          <input
            className="input td-input"
            value={s.expectedText ?? ''}
            placeholder={s.expected === 'success' ? 'Welcome' : 'Error text'}
            onChange={(e) => props.onExpected({ expectedText: e.target.value || undefined })}
            aria-label="Expected text"
          />
        </td>
        <td className="td-actions">
          <button type="button" className="icon-btn" onClick={props.onDuplicate} title="Duplicate case" aria-label="Duplicate case">
            <Copy size={14} />
          </button>
          <button type="button" className="icon-btn" onClick={props.onDelete} title="Remove case" aria-label="Remove case">
            <Trash size={14} />
          </button>
        </td>
      </tr>
      {props.problems.length > 0 && (
        <tr className="td-issues">
          <td colSpan={cols}>Skipped until fixed: {props.problems.join(' · ')}</td>
        </tr>
      )}
    </>
  )
}

function ValueInput({ param: p, value, onChange }: { param: FormParam; value: string | boolean | undefined; onChange: (v: string | boolean) => void }) {
  if (p.type === 'boolean') {
    return (
      <label className="check td-check">
        <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} /> {value ? 'checked' : 'unchecked'}
      </label>
    )
  }
  if ((p.kind === 'select' || p.kind === 'radio') && p.options.length > 0) {
    const v = typeof value === 'string' ? value : ''
    return (
      <select className="select td-input" value={v} onChange={(e) => onChange(e.target.value)} aria-label={p.name}>
        {!p.options.some((o) => o.value === v) && <option value={v}>{v || '(empty)'}</option>}
        {p.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label || o.value}
          </option>
        ))}
      </select>
    )
  }
  return (
    <input
      className="input td-input td-value"
      value={typeof value === 'string' ? value : ''}
      placeholder="(empty)"
      onChange={(e) => onChange(e.target.value)}
      spellCheck={false}
      aria-label={p.name}
    />
  )
}

/** Keeps only known parameters with the right value types; never trusts imported structure. */
function sanitize(raw: unknown, params: FormParam[]): TestScenario {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const values = (c.values && typeof c.values === 'object' ? c.values : c) as Record<string, unknown>
  return {
    id: newId(),
    name: typeof c.name === 'string' && c.name.trim() ? c.name : 'Imported case',
    values: Object.fromEntries(
      params.map((p) => {
        const v = values[p.name]
        return [p.name, p.type === 'boolean' ? v === true : typeof v === 'string' ? v : '']
      }),
    ),
    expected: c.expected === 'success' ? 'success' : 'failure',
    expectedUrl: typeof c.expectedUrl === 'string' && c.expectedUrl ? c.expectedUrl : undefined,
    expectedText: typeof c.expectedText === 'string' && c.expectedText ? c.expectedText : undefined,
  }
}
