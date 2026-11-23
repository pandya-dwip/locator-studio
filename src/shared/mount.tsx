import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { initTheme } from './utils/theme'
import '../styles/theme.css'

/** Shared bootstrap for extension pages (popup, workspace). */
export function mount(app: ReactNode): void {
  const el = document.getElementById('root')
  if (!el) throw new Error('#root element missing')
  initTheme().catch(console.error)
  createRoot(el).render(<StrictMode>{app}</StrictMode>)
}
