import { useEffect, useState } from 'react'
import { Crosshair, ExternalLink, Globe, LoaderCircle, ScanSearch } from 'lucide-react'
import { useScanState } from '../shared/hooks'
import { getActiveTab, openWorkspace, startScan } from '../shared/messaging'
import type { PageInfo, ScanState } from '../shared/types'
import { errorMessage, isScannableUrl } from '../shared/utils'

export function Popup() {
  // undefined = loading, null = no tab available
  const [page, setPage] = useState<PageInfo | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scan = useScanState()

  useEffect(() => {
    getActiveTab().then(setPage, (err) => {
      setError(errorMessage(err))
      setPage(null)
    })
  }, [])

  const scannable = !!page && isScannableUrl(page.url)
  // Only show scan status that belongs to this tab.
  const tabScan = scan && page && scan.tabId === page.tabId ? scan : null

  async function handleScan() {
    if (!page) return
    setBusy(true)
    setError(null)
    try {
      await startScan(page.tabId)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleOpenWorkspace() {
    try {
      await openWorkspace()
      window.close()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <main className="popup">
      <header className="popup-header">
        <span className="logo" aria-hidden="true">
          <Crosshair size={16} />
        </span>
        <h1>Locator Studio</h1>
        <span className="version">v{chrome.runtime.getManifest().version}</span>
      </header>

      <section className="card page-card" aria-label="Current page">
        {page === undefined ? (
          <p className="muted">Reading current tab…</p>
        ) : page === null ? (
          <p className="muted">No active tab.</p>
        ) : (
          <>
            <div className="page-title">
              {page.favIconUrl ? <img src={page.favIconUrl} alt="" width={16} height={16} /> : <Globe size={16} />}
              <span className="truncate" title={page.title}>{page.title || 'Untitled page'}</span>
            </div>
            <code className="page-url truncate" title={page.url}>{page.url || 'URL unavailable'}</code>
          </>
        )}
      </section>

      <div className="status-row">
        <ScanStatusLine scan={tabScan} scannable={scannable} loading={page === undefined} />
      </div>

      {error && <p className="error" role="alert">{error}</p>}

      <div className="actions">
        <button className="btn btn-primary btn-block" onClick={handleScan} disabled={!scannable || busy}>
          {busy ? <LoaderCircle size={14} className="spin" /> : <ScanSearch size={14} />}
          {busy ? 'Scanning…' : 'Scan page'}
        </button>
        <button className="btn btn-block" onClick={handleOpenWorkspace}>
          <ExternalLink size={14} />
          Open workspace
        </button>
      </div>
    </main>
  )
}

function ScanStatusLine({ scan, scannable, loading }: { scan: ScanState | null; scannable: boolean; loading: boolean }) {
  if (loading) return null
  if (!scannable) return <span className="status" data-status="error">This page can't be scanned.</span>
  if (!scan || scan.status === 'idle') return <span className="status muted">Not scanned yet</span>
  if (scan.status === 'scanning') return <span className="status" data-status="scanning">Scanning…</span>
  if (scan.status === 'error') return <span className="status" data-status="error">Scan failed: {scan.error}</span>
  return (
    <span className="status" data-status="done">
      {scan.summary?.totalElements ?? 0} elements extracted ·{' '}
      {new Date(scan.updatedAt).toLocaleTimeString()}
    </span>
  )
}
