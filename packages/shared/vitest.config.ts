// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // Only run source tests to avoid running compiled duplicates from dist/.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['**/dist/**'],
    // The first test of several conjugation files pays the engine's one-time
    // warm-up (~1 s of CPU idle, several under load), and the sweep files run
    // alongside; 5 s is too tight on a loaded CI runner.
    testTimeout: 20_000,
  },
});
