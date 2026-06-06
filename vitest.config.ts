import { defineConfig } from 'vitest/config';

/**
 * Vitest config — the pure `engine/` is tested to 100% coverage with zero VS Code
 * mocking. Only engine sources count toward coverage; glue is covered by the
 * @vscode/test-electron integration smoke suite instead.
 */
export default defineConfig({
  test: {
    include: ['test/engine/**/*.test.ts', 'test/perf/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/engine/**/*.ts'],
      exclude: ['src/engine/types.ts'],
      reporter: ['text', 'html'],
      thresholds: {
        lines: 100,
        branches: 100,
        functions: 100,
        statements: 100,
      },
    },
  },
});
