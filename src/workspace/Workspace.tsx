import { useEffect, useState } from 'react'
import { Crosshair, FileCode, LayoutDashboard, ListTree, MousePointerClick, Settings, type LucideIcon } from 'lucide-react'
import { DashboardPage } from '../features/dashboard/DashboardPage'
import { ElementsPage } from '../features/explorer/ElementsPage'
import { InspectorPage } from '../features/inspector/InspectorPage'
import { PomGeneratorPage } from '../features/pom-generator/PomGeneratorPage'
import { SettingsPage } from '../features/settings/SettingsPage'

interface Route {
  id: string
  label: string
  description: string
  icon: LucideIcon
  Page: () => React.ReactNode
}

const ROUTES: Route[] = [
  { id: 'dashboard', label: 'Dashboard', description: 'Overview of the latest scan.', icon: LayoutDashboard, Page: DashboardPage },
  { id: 'elements', label: 'Elements', description: 'Browse, search and inspect elements extracted from the scanned page.', icon: ListTree, Page: ElementsPage },
  { id: 'inspector', label: 'Inspector', description: 'Inspect and highlight a single element.', icon: MousePointerClick, Page: InspectorPage },
  { id: 'pom', label: 'POM Generator', description: 'Generate Playwright Page Object Model code.', icon: FileCode, Page: PomGeneratorPage },
  { id: 'settings', label: 'Settings', description: 'Preferences for Locator Studio.', icon: Settings, Page: SettingsPage },
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

      <main className="content">
        <header className="content-header">
          <h2>{route.label}</h2>
          <p className="muted">{route.description}</p>
        </header>
        <div className="content-body">
          <route.Page />
        </div>
      </main>
    </div>
  )
}
