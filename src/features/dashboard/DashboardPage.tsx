import { ScanSearch } from 'lucide-react'
import { useScanState } from '../../shared/hooks'
import type { ScanSummary } from '../../shared/types'
import { EmptyState } from '../../shared/ui/EmptyState'

export const hiddenCount = (s: ScanSummary) => s.byVisibility.hidden + s.byVisibility['not-rendered']

export function DashboardPage() {
  const scan = useScanState()
  const summary = scan?.summary

  if (!scan || scan.status === 'idle') {
    return (
      <EmptyState icon={ScanSearch} title="No scans yet">
        Open a page, click the Locator Studio toolbar icon and press <strong>Scan page</strong>.
      </EmptyState>
    )
  }

  return (
    <div className="stat-grid">
      <Stat label="Status">
        <span className="status" data-status={scan.status}>{scan.status}</span>
      </Stat>
      <Stat label="Page">
        <span className="truncate" title={scan.url}>{scan.title || scan.url || '—'}</span>
      </Stat>
      <Stat label="Elements extracted">{summary?.totalElements ?? '—'}</Stat>
      <Stat label="Visible / hidden">
        {summary ? `${summary.byVisibility.visible} / ${hiddenCount(summary)}` : '—'}
      </Stat>
      <Stat label="Interactive / form">
        {summary ? `${summary.byCategory.interactive} / ${summary.byCategory.form}` : '—'}
      </Stat>
      <Stat label="Last updated">{new Date(scan.updatedAt).toLocaleString()}</Stat>
      {scan.error && (
        <Stat label="Error" wide>
          <span className="text-danger">{scan.error}</span>
        </Stat>
      )}
    </div>
  )
}

function Stat({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`card stat${wide ? ' stat-wide' : ''}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{children}</span>
    </div>
  )
}
