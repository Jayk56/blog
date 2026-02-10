import { defineConfig } from 'vitest/config'

/** Vitest configuration for server unit tests. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts']
  }
})
