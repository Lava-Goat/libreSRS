// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { afterEach, beforeAll } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { registerMessages } from '../i18n';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

function ensureStorage(name: 'localStorage' | 'sessionStorage') {
  const current = globalThis[name] as Partial<Storage> | undefined;
  if (
    !current ||
    typeof current.getItem !== 'function' ||
    typeof current.setItem !== 'function' ||
    typeof current.removeItem !== 'function' ||
    typeof current.clear !== 'function' ||
    typeof current.key !== 'function'
  ) {
    // Some environments expose placeholder storage objects without Storage methods.
    Object.defineProperty(globalThis, name, {
      value: createMemoryStorage(),
      configurable: true,
      writable: true,
    });
  }
}

ensureStorage('localStorage');
ensureStorage('sessionStorage');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Each vitest project's extensions (none for core, through the alias) bring their strings, as main.tsx does.
// Imported in beforeAll, once the test file's vi.mock() calls are in place: a static import here would load
// every extension module (and what it imports, api/trpc among them) before a test file could mock it.
beforeAll(async () => {
  const { clientExtensions } = await import('@libresrs/client-extensions');
  registerMessages(clientExtensions.messages);
});

afterEach(() => {
  cleanup();
});

export {};
