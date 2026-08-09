import js from '@eslint/js'

export default [
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'] },
  js.configs.recommended,
  {
    // Build scripts run under Node, not in the app. They are allowed to talk to a
    // terminal — reporting what they generated is the point of running them.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { console: 'readonly', process: 'readonly', URL: 'readonly' },
    },
  },
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
  {
    // F0.11's acceptance criterion, as a rule rather than a convention: no model
    // call exists outside src/agent/client.ts. Everything that makes a model call
    // safe here — the agent_runs row, the untrusted-input framing, the guarantee
    // that a failure escalates instead of refusing a customer — lives in the
    // wrapper, and a second import of the SDK is how all three get skipped at once.
    files: ['**/*.ts', '**/*.tsx'],
    ignores: ['src/agent/client.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@anthropic-ai/sdk', '@anthropic-ai/sdk/**'],
              message:
                'Model calls go through src/agent/client.ts (F0.11). It logs to agent_runs, frames customer content as data, and returns a failure instead of throwing at a customer.',
            },
          ],
        },
      ],
    },
  },
]
