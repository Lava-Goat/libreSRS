# @esbuild-kit/core-utils (stand-in)

A code-free stand-in for `@esbuild-kit/core-utils` 3.3.2, which drizzle-kit pulls in through
`@esbuild-kit/esm-loader`. The root `package.json` installs it as a `file:` dev dependency, so npm
uses this copy in its place.

Its only job is the dependency line `esbuild: ^0.27.0` in `package.json`, so the install does not
carry the old esbuild that the real 3.3.2 pins.

It has no `dist/`, so anything that loads it fails; drizzle-kit 0.31 does not load it. Remove it
when drizzle-kit drops `@esbuild-kit/esm-loader`.

The upstream MIT licence is kept in `LICENSE`.
