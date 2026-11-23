import { FileCode } from 'lucide-react'
import { useSettings } from '../../shared/hooks'
import { EmptyState } from '../../shared/ui/EmptyState'

export function PomGeneratorPage() {
  const { language } = useSettings()

  return (
    <div className="stack">
      <div className="toolbar">
        <fieldset className="segmented" disabled>
          <legend className="sr-only">Elements to include</legend>
          <label><input type="radio" name="scope" defaultChecked /> Selected elements</label>
          <label><input type="radio" name="scope" /> All eligible</label>
        </fieldset>
        <span className="muted">
          Output: <strong>{language === 'typescript' ? 'TypeScript' : 'JavaScript'}</strong> (change in Settings)
        </span>
      </div>
      <EmptyState icon={FileCode} title="No Page Object yet">
        Playwright Page Object Model code will be generated here from your selected or all eligible elements.
      </EmptyState>
    </div>
  )
}
