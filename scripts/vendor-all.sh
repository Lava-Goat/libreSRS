#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

"$ROOT_DIR/scripts/vendor-node-deps.sh"

echo "All vendored assets are prepared in:"
echo "  $ROOT_DIR/vendor"
