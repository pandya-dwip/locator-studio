import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { crx, type CrxPlugin } from '@crxjs/vite-plugin'
import manifest from './manifest.config.ts'

// CRXJS marks the on-demand content script as web-accessible to every http(s)
// site. We inject it with chrome.scripting.executeScript, which doesn't need
// that, and exposing it lets any website detect the extension. Build-only, so
// dev mode keeps CRXJS's default behaviour.
const stripWebAccessibleResources: CrxPlugin = {
  name: 'locator-studio:strip-web-accessible-resources',
  apply: 'build',
  enforce: 'post',
  // CRXJS calls this hook on every Vite plugin after it has built the manifest.
  renderCrxManifest(manifest) {
    delete manifest.web_accessible_resources
    return manifest
  },
}

export default defineConfig({
  plugins: [react(), crx({ manifest }), stripWebAccessibleResources],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    // Fixed port: the dev build of the extension loads modules from it.
    port: 5180,
    strictPort: true,
    // Allow the extension origin to load modules from the dev server.
    cors: { origin: [/chrome-extension:\/\//] },
  },
})
