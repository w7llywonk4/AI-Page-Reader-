#!/usr/bin/env bash
set -euo pipefail

EXT_NAME="study-sahurrr-v3"
RELEASE_DIR="release"
STAGE_DIR="${RELEASE_DIR}/${EXT_NAME}"
ZIP_PATH="${RELEASE_DIR}/${EXT_NAME}.zip"

FILES=(
  manifest.json
  background.js
  content.js
  inject.css
  sidepanel.html
  sidepanel.js
  icon.png
)

mkdir -p "$RELEASE_DIR"
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"

for f in "${FILES[@]}"; do
  if [[ ! -f "$f" ]]; then
    echo "Missing required file: $f" >&2
    exit 1
  fi
  cp "$f" "$STAGE_DIR/"
done

python3 - <<'PY'
import json
from pathlib import Path
manifest = Path('manifest.json')
json.loads(manifest.read_text(encoding='utf-8'))
print('manifest.json is valid JSON')
PY

rm -f "$ZIP_PATH"
(
  cd "$STAGE_DIR"
  zip -q -r "../${EXT_NAME}.zip" .
)

echo "Done."
echo "ZIP: $ZIP_PATH"
echo "Extract and load unpacked folder: $STAGE_DIR"
