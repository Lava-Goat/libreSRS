#!/usr/bin/env bash

set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <download_base_url> <output_path>" >&2
  exit 1
fi

DOWNLOAD_BASE="$1"
OUT_PATH="$2"
TEMPLATE_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/libresrs-install.sh.in"

mkdir -p "$(dirname "$OUT_PATH")"

sed "s|^DOWNLOAD_BASE_DEFAULT=\"__DOWNLOAD_BASE__\"$|DOWNLOAD_BASE_DEFAULT=\"$DOWNLOAD_BASE\"|" "$TEMPLATE_PATH" > "$OUT_PATH"
chmod +x "$OUT_PATH"
