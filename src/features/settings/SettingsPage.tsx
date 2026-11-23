import { useSettings } from '../../shared/hooks'
import type { OutputLanguage, ThemePreference } from '../../shared/types'
import { TEST_ID_ATTRIBUTES } from '../../shared/constants'
import { updateSettings } from '../../storage'

const THEMES: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

const LANGUAGES: { value: OutputLanguage; label: string }[] = [
  { value: 'typescript', label: 'TypeScript' },
  { value: 'javascript', label: 'JavaScript' },
]

export function SettingsPage() {
  const settings = useSettings()
  const save = (patch: Parameters<typeof updateSettings>[0]) => updateSettings(patch).catch(console.error)

  return (
    <div className="card settings">
      <Row title="Theme" description="Applies to the popup and workspace.">
        <Segmented name="theme" options={THEMES} value={settings.theme} onChange={(theme) => save({ theme })} />
      </Row>
      <Row title="Output language" description="Language used for generated Playwright code.">
        <Segmented
          name="language"
          options={LANGUAGES}
          value={settings.language}
          onChange={(language) => save({ language })}
        />
      </Row>
      <Row
        title="Test ID attribute"
        description="Must match testIdAttribute in your playwright.config. Elements with this attribute get getByTestId(); other test attributes are written as CSS."
      >
        <select
          className="select"
          value={settings.testIdAttribute}
          onChange={(e) => save({ testIdAttribute: e.target.value })}
          aria-label="Test ID attribute"
        >
          {TEST_ID_ATTRIBUTES.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </Row>
      <Row title="Data" description="All data is stored locally in this browser. Nothing is sent anywhere." />
    </div>
  )
}

function Row({ title, description, children }: { title: string; description: string; children?: React.ReactNode }) {
  return (
    <div className="settings-row">
      <div>
        <h3>{title}</h3>
        <p className="muted">{description}</p>
      </div>
      {children}
    </div>
  )
}

function Segmented<T extends string>(props: {
  name: string
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={props.name}>
      {props.options.map((o) => (
        <label key={o.value}>
          <input
            type="radio"
            name={props.name}
            value={o.value}
            checked={props.value === o.value}
            onChange={() => props.onChange(o.value)}
          />
          {o.label}
        </label>
      ))}
    </div>
  )
}
