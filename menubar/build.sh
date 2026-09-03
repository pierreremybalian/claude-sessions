#!/usr/bin/env bash
# Builds the menu bar front end into dist-app/Claude Sessions.app.
# Pass --install to copy it into /Applications and launch it.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NAME="Claude Sessions"
OUT="$ROOT/dist-app/$NAME.app"

command -v swiftc >/dev/null || {
  echo "swiftc not found — install the Xcode Command Line Tools: xcode-select --install" >&2
  exit 1
}

rm -rf "$OUT"
mkdir -p "$OUT/Contents/MacOS" "$OUT/Contents/Resources"

cat > "$OUT/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>$NAME</string>
  <key>CFBundleDisplayName</key><string>$NAME</string>
  <key>CFBundleIdentifier</key><string>com.pierrebalian.claude-sessions</string>
  <key>CFBundleExecutable</key><string>ClaudeSessions</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0.0</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
  <key>CSInstallRoot</key><string>$ROOT</string>
</dict>
</plist>
PLIST

swiftc -O -o "$OUT/Contents/MacOS/ClaudeSessions" \
  "$ROOT/menubar/ClaudeSessions.swift" \
  -framework Cocoa -framework CoreImage

# Ad-hoc signature: enough for Gatekeeper to run a locally built app.
codesign --force --sign - "$OUT" >/dev/null 2>&1 || true

# Remember the checkout, so the app still works if it is moved or rebuilt elsewhere.
mkdir -p "$HOME/.claude-sessions"
printf '%s\n' "$ROOT" > "$HOME/.claude-sessions/root"

echo "Built $OUT"

if [[ "${1:-}" == "--install" ]]; then
  rm -rf "/Applications/$NAME.app"
  cp -R "$OUT" "/Applications/$NAME.app"
  open "/Applications/$NAME.app"
  echo "Installed to /Applications/$NAME.app and launched — look for the clock icon in the menu bar."
fi
