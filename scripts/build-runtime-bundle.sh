#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${1:-$ROOT_DIR/dist/release}"
RUNTIME_DIR="$OUT_DIR/libresrs"

echo "Building workspace artifacts..."
npm run build -w @libresrs/shared
npm run build -w @libresrs/server
npm run build -w @libresrs/client

echo "Preparing runtime-only bundle..."
rm -rf "$OUT_DIR"
mkdir -p "$RUNTIME_DIR/packages/server" "$RUNTIME_DIR/packages/shared"

cp -R "$ROOT_DIR/packages/server/dist" "$RUNTIME_DIR/packages/server/dist"
cp -R "$ROOT_DIR/packages/server/drizzle" "$RUNTIME_DIR/packages/server/drizzle"
cp -R "$ROOT_DIR/packages/client/dist" "$RUNTIME_DIR/packages/server/public"
cp -R "$ROOT_DIR/packages/shared/dist" "$RUNTIME_DIR/packages/shared/dist"

# Keep runtime bundle production-focused.
find "$RUNTIME_DIR/packages/shared/dist" -type f \( -name "*.test.js" -o -name "*.test.js.map" -o -name "*.test.d.ts" -o -name "*.test.d.ts.map" \) -delete
rm -rf "$RUNTIME_DIR/packages/server/dist/testUtils"

cp "$ROOT_DIR/logo.svg" "$RUNTIME_DIR/logo.svg"
cp "$ROOT_DIR/README.md" "$RUNTIME_DIR/README.md"
cp "$ROOT_DIR/.env.example" "$RUNTIME_DIR/.env.example"
cp "$ROOT_DIR/LICENSE" "$RUNTIME_DIR/LICENSE"

node - "$ROOT_DIR" "$RUNTIME_DIR" <<'NODE'
const fs = require('fs');
const path = require('path');

const root = process.argv[2];
const runtime = process.argv[3];

const serverPkgPath = path.join(root, 'packages', 'server', 'package.json');
const sharedPkgPath = path.join(root, 'packages', 'shared', 'package.json');

const serverPkg = JSON.parse(fs.readFileSync(serverPkgPath, 'utf8'));
const sharedPkg = JSON.parse(fs.readFileSync(sharedPkgPath, 'utf8'));

const serverRuntimePkg = {
  name: serverPkg.name,
  version: serverPkg.version,
  private: true,
  type: serverPkg.type,
  main: serverPkg.main,
  scripts: {
    start: serverPkg.scripts?.start ?? 'node dist/index.js',
  },
  dependencies: {
    ...(serverPkg.dependencies ?? {}),
    '@libresrs/shared': 'file:../shared',
  },
};

const sharedRuntimePkg = {
  name: sharedPkg.name,
  version: sharedPkg.version,
  private: true,
  type: sharedPkg.type,
  main: sharedPkg.main,
  types: sharedPkg.types,
  exports: sharedPkg.exports,
  dependencies: sharedPkg.dependencies ?? {},
};

const serverOutPath = path.join(runtime, 'packages', 'server', 'package.json');
const sharedOutPath = path.join(runtime, 'packages', 'shared', 'package.json');

fs.writeFileSync(serverOutPath, `${JSON.stringify(serverRuntimePkg, null, 2)}\n`);
fs.writeFileSync(sharedOutPath, `${JSON.stringify(sharedRuntimePkg, null, 2)}\n`);
NODE

echo "Creating archive..."
tar -C "$OUT_DIR" -czf "$OUT_DIR/libresrs-runtime.tar.gz" libresrs

echo "Writing checksum..."
if command -v sha256sum >/dev/null 2>&1; then
  (
    cd "$OUT_DIR"
    sha256sum "libresrs-runtime.tar.gz" > "libresrs-runtime.sha256"
  )
elif command -v shasum >/dev/null 2>&1; then
  (
    cd "$OUT_DIR"
    shasum -a 256 "libresrs-runtime.tar.gz" > "libresrs-runtime.sha256"
  )
else
  echo "No SHA-256 tool found (need sha256sum or shasum)" >&2
  exit 1
fi

echo "Runtime bundle ready:"
echo "  - $OUT_DIR/libresrs-runtime.tar.gz"
echo "  - $OUT_DIR/libresrs-runtime.sha256"
