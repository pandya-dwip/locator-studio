import { STORAGE_KEYS } from '../constants'
import type { Settings, ThemePreference } from '../types'
import { getSettings, watchKey } from '../../storage'

function applyTheme(theme: ThemePreference) {
  document.documentElement.dataset.theme = theme
}

/** Apply the saved theme and keep every open extension page in sync with it. */
export async function initTheme(): Promise<void> {
  applyTheme((await getSettings()).theme)
  watchKey<Settings | undefined>(STORAGE_KEYS.settings, (s) => applyTheme(s?.theme ?? 'system'))
}
