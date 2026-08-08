import js from '@eslint/js'

export default [
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'] },
  js.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: (await import('@typescript-eslint/parser')).default,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
      globals: { console: 'readonly', process: 'readonly', URL: 'readonly', Intl: 'readonly' },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'off', // TypeScript handles this, and it false-positives on types
    },
  },
]
