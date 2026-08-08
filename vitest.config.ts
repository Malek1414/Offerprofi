import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The Art. 22 invariant tests are the CI gate (FEATURE_INVENTORY F4.14 / X7).
    // They must never be silently skipped.
    passWithNoTests: false,
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
})
