import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: {
    environment: 'node',
    // `.tsx` as well, because the price-leak test renders the request document and
    // greps the output. A rule about what may appear on a page is best asserted
    // against the page.
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // The Art. 22 invariant tests are the CI gate (FEATURE_INVENTORY F4.14 / X7).
    // They must never be silently skipped.
    passWithNoTests: false,
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // The app compiles JSX through Next's automatic runtime; the test transform has
  // to agree, or a component under test fails on `React is not defined` rather
  // than on anything real.
  esbuild: { jsx: 'automatic' },
})
