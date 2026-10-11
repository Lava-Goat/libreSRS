#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${1:-$ROOT_DIR/packages/server/dist}"

tag="${GIT_TAG:-}"
if [ -z "$tag" ] && [ "${GITHUB_REF_TYPE:-}" = "tag" ]; then
  tag="${GITHUB_REF_NAME:-}"
fi
if [ -z "$tag" ] && command -v git >/dev/null 2>&1; then
  tag="$(git -C "$ROOT_DIR" describe --tags --match 'v*' --exact-match 2>/dev/null || true)"
fi
if [ -n "$tag" ] && [[ "$tag" != v* ]]; then
  tag=""
fi

commit="${GIT_COMMIT:-}"
if [ -z "$commit" ] && command -v git >/dev/null 2>&1; then
  commit="$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || true)"
fi
commit="${commit:0:7}"
if [ -z "$commit" ]; then
  commit="unknown"
fi

node - "$OUT_DIR/build-info.json" "$tag" "$commit" <<'NODE'
const fs = require('fs');
const path = require('path');

const outputPath = process.argv[2];
const tag = process.argv[3] || '';
const commit = (process.argv[4] || 'unknown').slice(0, 7) || 'unknown';
const reference = tag || commit;

const payload = {
  // "version" is always the single build reference: a v* tag if present, else the short hash.
  version: reference,
  tag: tag || null,
  commit,
  reference,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
NODE
