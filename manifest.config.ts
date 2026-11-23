import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json' with { type: 'json' }

export default defineManifest({
  manifest_version: 3,
  name: 'Locator Studio',
  description: pkg.description,
  version: pkg.version,
  icons: {
    16: 'icons/icon-16.png',
    32: 'icons/icon-32.png',
    48: 'icons/icon-48.png',
    128: 'icons/icon-128.png',
  },
  action: {
    default_title: 'Locator Studio',
    default_popup: 'index.html',
    default_icon: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
    },
  },
  // The full-page workspace. Declaring it as the options page makes CRXJS serve
  // it in dev mode and lets openOptionsPage() focus an existing workspace tab.
  options_ui: {
    page: 'workspace.html',
    open_in_tab: true,
  },
  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },
  // No host_permissions and no static content_scripts: the content script is
  // injected on demand into the active tab when the user clicks "Scan".
  permissions: ['activeTab', 'scripting', 'storage'],
})
