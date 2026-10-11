// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * No extensions: what @libresrs/server-extensions resolves to when
 * src/extensions/enabled.ts does not exist (tsconfig "paths"), and the
 * registry's empty start.
 */
import { combine, type NoFields } from './api.js';

export type Fields = NoFields;
export type Routers = {};
export const extensions = combine<Fields, Routers>();
