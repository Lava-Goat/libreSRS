// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Where @libresrs/client-extensions points at build and test time:
 * src/extensions/enabled.tsx when this tree has it, else src/extensions/none.tsx.
 * The tsconfig "paths" make the same choice for types. LIBRESRS_EXTENSIONS=none
 * (or mode 'none') forces none, as the core vitest project does.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const at = (file: string) => fileURLToPath(new URL(file, import.meta.url));

export const hasClientExtensions = existsSync(at('./src/extensions/enabled.tsx'));

export function extensionAlias(
  mode: 'auto' | 'none' = process.env.LIBRESRS_EXTENSIONS === 'none' ? 'none' : 'auto',
): Record<string, string> {
  return {
    '@libresrs/client-extensions': at(mode !== 'none' && hasClientExtensions ? './src/extensions/enabled.tsx' : './src/extensions/none.tsx'),
  };
}
