import { useEffect, useState } from 'react'
import { Crosshair, FileCode, ListTree, Settings, type LucideIcon } from 'lucide-react'
import { ElementsPage } from '../features/explorer/ElementsPage'
import { PomGeneratorPage } from '../features/pom-generator/PomGeneratorPage'
import { SettingsPage } from '../features/settings/SettingsPage'

interface Route {
  id: string
  label: string
  icon: LucideIcon
  Page: () => React.ReactNode
  /** Full-height page that manages its own layout and header (no page title bar). */
  fullHeight?: boolean
}

const ROUTES: Route[] = [
  { id: 'elements', label: 'Elements', icon: ListTree, Page: ElementsPage, fullHeight: true },
  { id: 'pom', label: 'POM Generator', icon: FileCode, Page: PomGeneratorPage },
  { id: 'settings', label: 'Settings', icon: Settings, Page: SettingsPage },
]

const routeFromHash = () => ROUTES.find((r) => r.id === location.hash.slice(1)) ?? ROUTES[0]!

export function Workspace() {
  // Hash routing: survives reloads, no router dependency.
  const [route, setRoute] = useState(routeFromHash)

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    document.title = `${route.label} · Locator Studio`
  }, [route])

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            <Crosshair size={14} />
          </span>
          Locator Studio
        </div>
        <nav aria-label="Workspace">
          {ROUTES.map(({ id, label, icon: Icon }) => (
            <a key={id} href={`#${id}`} className="nav-item" aria-current={id === route.id ? 'page' : undefined}>
              <Icon size={15} />
              {label}
            </a>
          ))}
        </nav>
        <footer className="sidebar-footer">v{chrome.runtime.getManifest().version}</footer>
      </aside>

      {route.fullHeight ? (
        <main className="content content-full">
          <route.Page />
        </main>
      ) : (
        <main className="content">
          <header className="content-header">
            <h2>{route.label}</h2>
          </header>
          <div className="content-body">
            <route.Page />
          </div>
        </main>
      )}
    </div>
  )
}
