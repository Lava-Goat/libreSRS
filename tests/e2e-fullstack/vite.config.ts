// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The client's own Vite config (packages/client/vite.config.ts), served for
 * the full-stack e2e run: proxied to this run's API port, on its own port and
 * dependency cache so a `npm run dev` or the mocked suite can run beside it,
 * and frozen: no file watching and no HMR, so a source file saved mid-run
 * (another agent, an editor) cannot reload the page under a test.
 */
import { defineConfig, mergeConfig, type ConfigEnv, type UserConfig } from 'vite';
import clientConfig from '../../packages/client/vite.config';
import { PORTS } from './env';

const api = `http://localhost:${PORTS.api}`;

export default defineConfig(async (env: ConfigEnv) => {
  const base = (typeof clientConfig === 'function' ? await clientConfig(env) : clientConfig) as UserConfig;
  return mergeConfig(base, {
    cacheDir: 'node_modules/.vite-e2e-fullstack',
    server: {
      host: '127.0.0.1',
      port: PORTS.client,
      strictPort: true,
      hmr: false,
      watch: null,
      // Compiled before the first test instead of during it: the app and the lazy pages the specs open.
      warmup: {
        clientFiles: ['./src/main.tsx', './src/pages/Conjugation.tsx', './src/pages/ConjugationAll.tsx', './src/components/conjugation/ConjugationSettings.tsx'],
      },
      proxy: {
        '/api': { target: api, changeOrigin: true },
        '/auth': { target: api, changeOrigin: true },
      },
    },
  } satisfies UserConfig);
});
