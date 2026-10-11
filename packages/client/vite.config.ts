// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { execSync } from 'child_process';
import { extensionAlias } from './extensions.alias';

function getShortGitHash() {
  try {
    const hash = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    return hash || 'unknown';
  } catch {
    return 'unknown';
  }
}

function normalizeVTag(value: string | undefined) {
  const trimmed = (value ?? '').trim();
  return trimmed.startsWith('v') ? trimmed : '';
}

function getGitTagAtHead() {
  try {
    const tag = execSync("git describe --tags --match 'v*' --exact-match", { encoding: 'utf8' }).trim();
    return normalizeVTag(tag);
  } catch {
    return '';
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, resolve(__dirname, '../../'), '');
  const apiPort = env.PORT || '6767';
  const envTag =
    normalizeVTag(process.env.GIT_TAG) ||
    normalizeVTag(env.GIT_TAG) ||
    (process.env.GITHUB_REF_TYPE === 'tag' ? normalizeVTag(process.env.GITHUB_REF_NAME) : '') ||
    '';
  const gitTag = envTag || getGitTagAtHead();
  const commitSource = process.env.GIT_COMMIT || env.GIT_COMMIT || getShortGitHash();
  const gitCommit = commitSource.slice(0, 7);
  const reference = gitTag || gitCommit;
  // Extra host names the dev server answers to behind a proxy (comma-separated), for example
  // VITE_ALLOWED_HOSTS=dev.example.org. Empty: only localhost and IP addresses.
  const allowedHosts = (env.VITE_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);

  return {
    plugins: [react()],
    // @libresrs/client-extensions: this tree's extensions (src/extensions/enabled.tsx), or none.
    resolve: { alias: extensionAlias() },
    define: {
      // Single source of truth for displayed version: tag at HEAD, else short hash.
      __BUILD_VERSION__: JSON.stringify(reference),
      __BUILD_COMMIT__: JSON.stringify(gitCommit),
    },
    server: {
      port: 5173,
      host: '0.0.0.0',
      allowedHosts,
      proxy: {
        '/api': {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true,
        },
        '/auth': {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: 'dist',
      rollupOptions: {
        output: {
          manualChunks: {
            'react-vendor': ['react', 'react-dom', 'react-router-dom'],
            'query-vendor': ['@tanstack/react-query', '@trpc/client', '@trpc/react-query'],
            'markdown-vendor': ['react-markdown', 'rehype-raw'],
          },
        },
      },
    },
  };
});
