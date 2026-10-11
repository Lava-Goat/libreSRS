// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * No client extensions: what @libresrs/client-extensions resolves to when
 * src/extensions/enabled.tsx does not exist (tsconfig "paths" and the
 * Vite/vitest alias in extensions.alias.ts).
 */
import { combineClient } from './api';

export const clientExtensions = combineClient();
