import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: true,
    setupFiles: ['tests/setup.ts'],
    // PGlite boots a WASM Postgres per integration suite; give it room.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
