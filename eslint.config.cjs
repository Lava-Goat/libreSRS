const js = require('@eslint/js');
const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const globals = require('globals');

// The core extension API's own files (packages/*/src/extensions/*.ts(x)), which core may import.
const MECHANISM = ['api', 'index', 'registry', 'load', 'none', 'timers'];
const CORE_MESSAGE = 'Core must work without extensions: use a hook, slot or page hook (packages/server/src/extensions/README.md).';
// gitignore-style patterns (no {a,b} braces). An extension folder, its files, its bare directory
// import ('../extensions/my-ext', which resolves to its index), the aggregators and shared code.
const CORE_GROUP = [
  '**/extensions/*', '**/extensions/*/**', '@libresrs/shared/extensions/*',
  ...MECHANISM.flatMap((name) => [`!**/extensions/${name}`, `!**/extensions/${name}.*`]),
];
// The same for import(): esquery regexes cannot hold a "/", hence \x2F.
const notMechanism = `(?!(?:${MECHANISM.join('|')})(?:\\.[cm]?[jt]sx?)?$)`;
const coreDynamic = {
  selector: `ImportExpression[source.value=/(^|\\x2F)extensions\\x2F${notMechanism}/]`,
  message: CORE_MESSAGE,
};

module.exports = [
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/*.js', '**/*.cjs'],
  },
  js.configs.recommended,
  {
    files: ['packages/*/src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      'no-undef': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  // Extensions (packages/server/src/extensions/README.md). Each block names its plugin itself.
  {
    // 1. Core never imports an extension: it asks through ext(), slots and page hooks.
    files: ['packages/*/src/**/*.{ts,tsx}'],
    ignores: ['packages/*/src/extensions/*/**', 'packages/*/src/extensions/enabled.{ts,tsx}'],
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', {
        paths: [{ name: '@libresrs/server-extensions', allowTypeImports: true, message: CORE_MESSAGE }],
        patterns: [{ group: CORE_GROUP, message: CORE_MESSAGE }],
      }],
      'no-restricted-syntax': ['error', coreDynamic],
    },
  },
  {
    // 2. The mechanism files never import an extension folder by a relative path (enabled.* lists them).
    files: ['packages/*/src/extensions/*.{ts,tsx}'],
    ignores: ['packages/*/src/extensions/enabled.{ts,tsx}'],
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', {
        paths: [{ name: '@libresrs/server-extensions', allowTypeImports: true, message: CORE_MESSAGE }],
        patterns: [
          {
            // './my-ext', './my-ext/…' and './enabled'; the mechanism files are siblings it may import.
            group: ['./*', './*/**', ...MECHANISM.flatMap((name) => [`!./${name}`, `!./${name}.*`])],
            message: 'Only enabled.ts / enabled.tsx import an extension folder (packages/server/src/extensions/README.md).',
          },
          { group: CORE_GROUP, message: CORE_MESSAGE },
        ],
      }],
      'no-restricted-syntax': ['error', coreDynamic, {
        selector: `ImportExpression[source.value=/^\\.\\x2F${notMechanism}/]`,
        message: 'Only enabled.ts / enabled.tsx import an extension folder (packages/server/src/extensions/README.md).',
      }],
    },
  },
  {
    // 3. Extensions never import what loads them (cycles at boot and in the bundle); types are fine.
    files: ['packages/*/src/extensions/*/**/*.{ts,tsx}'],
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', {
        // '..' is the client's extensions/index.tsx (a pattern '..' would match every parent path).
        paths: [{
          name: '..',
          allowTypeImports: true,
          message: 'An extension never imports what loads it (packages/server/src/extensions/README.md); `import type` is fine.',
        }],
        patterns: [{
          // gitignore-style patterns: no {a,b} braces, so each name is listed.
          group: [
            '**/src/index*', '../../index', '../../index.*', '**/routers/index*',
            '**/routers/cards*', '**/routers/conjugation*', '**/routers/admin*',
            ...['index', 'registry', 'load', 'enabled'].flatMap((name) => [`**/extensions/${name}*`, `../${name}`, `../${name}.*`]),
            '**/pages/**',
            '**/components/conjugation/ConjugationRunner*', '**/components/admin/UserDetail',
          ],
          allowTypeImports: true,
          message: 'An extension never imports what loads it (packages/server/src/extensions/README.md); `import type` is fine.',
        }],
      }],
    },
  },
];
