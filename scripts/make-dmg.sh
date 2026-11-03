#!/usr/bin/env bash
# Create an unsigned macOS DMG without Finder Automation / Apple Events.
# Tauri's bundle_dmg.sh sends Apple Events to Finder and may fail with:
#   Not authorised to send Apple events to Finder (-1743)
# This script uses hdiutil -srcfolder only (no osascript / Finder).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MACOS_DIR="$ROOT/client/src-tauri/target/release/bundle/macos"

# productName is "Hive Nest" → bundle is "Hive Nest.app". Fall back to legacy HiveNest.app.
if [[ $# -ge 1 ]]; then
  APP="$1"
elif [[ -d "$MACOS_DIR/Hive Nest.app" ]]; then
  APP="$MACOS_DIR/Hive Nest.app"
elif [[ -d "$MACOS_DIR/HiveNest.app" ]]; then
  APP="$MACOS_DIR/HiveNest.app"
else
  APP="$MACOS_DIR/Hive Nest.app"
fi

OUT="${2:-$ROOT/dist/HiveNest-unsigned.dmg}"
VOL_NAME="${HIVENEST_DMG_VOLNAME:-Hive Nest}"

if [[ ! -d "$APP" ]]; then
  echo "App bundle not found: $APP" >&2
  echo "Build first: make tauri-build-unsigned   (targets may be app-only)" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUT")"
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/hivenest-dmg.XXXXXX")"
cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT

echo "Staging $APP -> $STAGE/"
cp -R "$APP" "$STAGE/"
ln -sf /Applications "$STAGE/Applications"

rm -f "$OUT"
echo "Creating UDZO DMG (no Finder): $OUT"
hdiutil create \
  -volname "$VOL_NAME" \
  -srcfolder "$STAGE" \
  -ov \
  -format UDZO \
  "$OUT"

echo "Done: $OUT"
ls -lh "$OUT"
