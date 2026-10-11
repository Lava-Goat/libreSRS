// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { extensionAlias, hasClientExtensions } from './extensions.alias';

const isCI =
  process.env.CI === 'true' ||
  process.env.CI === '1' ||
  process.env.GITHUB_ACTIONS === 'true' ||
  process.env.FORGEJO_ACTIONS === 'true';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    ...(isCI
      ? {
          testTimeout: 60_000,
          hookTimeout: 60_000,
        }
      : {}),
    // Two projects: core always runs with no extension (the alias forced to none), so it passes
    // alone in every tree; the extensions' own tests run with them, only where they exist (and not
    // under LIBRESRS_EXTENSIONS=none).
    // extends: true, or an inline project loses the plugins, jsdom, globals, setupFiles and timeouts above.
    projects: [
      {
        extends: true,
        resolve: { alias: extensionAlias('none') },
        test: {
          name: 'core',
          include: ['src/**/*.test.{ts,tsx}'],
          exclude: [...configDefaults.exclude, 'src/extensions/*/**'],
        },
      },
      ...(hasClientExtensions && process.env.LIBRESRS_EXTENSIONS !== 'none'
        ? [{
            extends: true,
            resolve: { alias: extensionAlias('auto') },
            test: {
              name: 'extensions',
              include: ['src/extensions/*/**/*.test.{ts,tsx}'],
            },
          }]
        : []),
    ],
  },
});
