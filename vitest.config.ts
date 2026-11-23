import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts so the CRXJS extension plugin is not loaded for tests.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
  },
})
