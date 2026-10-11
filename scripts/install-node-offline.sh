#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE_DIR="${NPM_VENDOR_CACHE:-$ROOT_DIR/vendor/npm-cache}"

# Optional first positional argument can override cache path.
if [ "${1:-}" != "" ] && [ "${1#-}" = "$1" ]; then
  CACHE_DIR="$1"
  shift
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required but was not found in PATH." >&2
  exit 1
fi

if [ ! -d "$CACHE_DIR/_cacache" ]; then
  echo "Vendored npm cache not found at $CACHE_DIR" >&2
  echo "Run scripts/vendor-node-deps.sh first." >&2
  exit 1
fi

echo "Installing dependencies from vendored cache: $CACHE_DIR"
cd "$ROOT_DIR"
npm ci --offline --cache "$CACHE_DIR" "$@"
