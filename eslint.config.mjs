import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

/**
 * Flat config. eslint-config-next 16 exports flat config arrays directly, so
 * no FlatCompat shim is needed.
 */
export default [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      '.pglite/**',
      '.storage/**',
      'src/lib/db/migrations/**',
      'playwright-report/**',
      'test-results/**',
      'next-env.d.ts',
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      // The codebase deliberately uses `require` in one place to keep a WASM
      // package out of the production bundle; flagged there with a comment.
      '@typescript-eslint/no-require-imports': 'warn',
    },
  },
];
