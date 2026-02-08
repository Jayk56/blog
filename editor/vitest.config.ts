import { defineConfig } from 'vitest/config'

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    globals: true,
    environment: 'jsdom',
    environmentMatchGlobs: [['server/**', 'node']],
    exclude: ['dist/**', 'node_modules/**'],
  },
})
