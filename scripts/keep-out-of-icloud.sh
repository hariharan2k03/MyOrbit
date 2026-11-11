#!/usr/bin/env bash
# The project lives in iCloud Drive. Big generated folders sit in "*.nosync"
# folders (which iCloud skips) behind a link with the usual name. npm and
# `expo prebuild --clean` replace those links with real folders; this puts
# them back. Safe to run any time (`npm run icloud`).
set -euo pipefail
cd "$(dirname "$0")/.."
for name in node_modules ios; do
  if [ -L "$name" ]; then continue; fi
  if [ -d "$name" ]; then
    rm -rf "$name.nosync"
    mv "$name" "$name.nosync"
  else
    mkdir -p "$name.nosync"
  fi
  ln -s "$name.nosync" "$name"
  echo "Moved $name out of iCloud sync ($name -> $name.nosync)"
done
