// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { defineConfig } from 'vitest/config';

const isCI =
  process.env.CI === 'true' ||
  process.env.CI === '1' ||
  process.env.GITHUB_ACTIONS === 'true' ||
  process.env.FORGEJO_ACTIONS === 'true';

export default defineConfig({
  test: {
    globals: true,
    // Only run source tests. This avoids picking up stale compiled test files in dist/
    // (possible on CI runners with persistent workspaces, or locally after past builds).
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['**/dist/**'],
    // Some tests dynamically re-import heavy module graphs (vi.resetModules pattern).
    // 5 s is too tight when running all 45 test files in parallel on a loaded dev machine.
    testTimeout: 15_000,
    ...(isCI
      ? {
          // Slow CI runners can be much slower than dev machines.
          // Use wider timeouts to avoid flaky hook/test failures under load.
          hookTimeout: 300_000,
          testTimeout: 300_000,
          teardownTimeout: 300_000,
          // Reduce I/O contention: run test files sequentially with a single worker.
          fileParallelism: false,
          maxWorkers: 1,
        }
      : {}),
  },
});
