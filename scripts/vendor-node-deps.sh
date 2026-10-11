#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE_DIR="${NPM_VENDOR_CACHE:-$ROOT_DIR/vendor/npm-cache}"
WORK_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required but was not found in PATH." >&2
  exit 1
fi

echo "Preparing vendored npm cache at $CACHE_DIR"
rm -rf "$CACHE_DIR"
mkdir -p "$CACHE_DIR"
mkdir -p "$WORK_DIR/packages"

cp "$ROOT_DIR/package.json" "$ROOT_DIR/package-lock.json" "$WORK_DIR/"
cp -R "$ROOT_DIR/patched-deps" "$WORK_DIR/patched-deps"

for package_dir in "$ROOT_DIR"/packages/*; do
  if [ -d "$package_dir" ] && [ -f "$package_dir/package.json" ]; then
    package_name="$(basename "$package_dir")"
    mkdir -p "$WORK_DIR/packages/$package_name"
    cp "$package_dir/package.json" "$WORK_DIR/packages/$package_name/package.json"
  fi
done

echo "Populating cache from lockfile..."
(
  cd "$WORK_DIR"
  npm ci --ignore-scripts --cache "$CACHE_DIR"

  # npm ci only fetches optional native packages for the current platform.
  # Seed every optional top-level package in the lockfile so offline installs
  # are deterministic across architectures (x64/arm64, linux/darwin, etc.).
  node -e "const lock=require('./package-lock.json'); const optionalPackages=new Set(); for (const [pkgPath,meta] of Object.entries(lock.packages||{})) { if (!pkgPath.includes('node_modules/')) continue; if (!meta.optional || !meta.version) continue; const name=pkgPath.split('node_modules/').pop(); if (!name) continue; optionalPackages.add(\`\${name}@\${meta.version}\`); } for (const entry of [...optionalPackages].sort()) console.log(entry);" \
    | while IFS= read -r pkg; do
      npm cache add "$pkg" --cache "$CACHE_DIR"
    done

  npm cache verify --cache "$CACHE_DIR"
)

echo "Vendored npm cache ready:"
echo "  $CACHE_DIR"
