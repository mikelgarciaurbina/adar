#!/usr/bin/env bash
# End-to-end test of the in-app updater with real packaged builds (macOS, takes a few minutes):
#   1. package Adar <base> (.app) and install it into <work>/Applications
#   2. package Adar <next> as a .zip and serve a fake "latest release" feed for it on 127.0.0.1
#   3. launch the installed app with ADAR_UPDATE_FEED + ADAR_UPDATE_TEST_AUTOINSTALL=1
#   4. expect the bundle to be replaced by <next> and relaunched
# Usage: scripts/test-updater.sh <workdir> [base=0.0.1] [next=0.0.2]
set -euo pipefail
cd "$(dirname "$0")/.."
WORK="$1"; BASE="${2:-0.0.1}"; NEXT="${3:-0.0.2}"
ARCH="$(uname -m)"; [ "$ARCH" = "x86_64" ] && ARCH=x64
rm -rf "$WORK"; mkdir -p "$WORK/Applications" "$WORK/feed"
export CSC_IDENTITY_AUTO_DISCOVERY=false

build() { # version target outdir
  ADAR_VERSION_OVERRIDE="$1" ./node_modules/.bin/electron-vite build >/dev/null
  ./node_modules/.bin/electron-builder --mac "$2" "--$ARCH" --publish never \
    -c.extraMetadata.version="$1" -c.directories.output="$3" >/dev/null
}

echo "Building base $BASE…"
build "$BASE" dir "$WORK/build-base"
cp -R "$WORK/build-base/mac-$ARCH/Adar.app" "$WORK/Applications/" 2>/dev/null || cp -R "$WORK"/build-base/mac*/Adar.app "$WORK/Applications/"

echo "Building next $NEXT…"
build "$NEXT" zip "$WORK/build-next"
ZIP="$(ls "$WORK"/build-next/*.zip | head -1)"
cp "$ZIP" "$WORK/feed/"
NAME="$(basename "$ZIP")"; SIZE="$(stat -f %z "$ZIP")"
PORT=58999
cat > "$WORK/feed/latest.json" <<JSON
{"tag_name":"v$NEXT","name":"Adar $NEXT","body":"Test release","html_url":"https://example.invalid","published_at":"2026-10-20T00:00:00Z","draft":false,"prerelease":false,
 "assets":[{"name":"$NAME","browser_download_url":"http://127.0.0.1:$PORT/$NAME","size":$SIZE}]}
JSON
( cd "$WORK/feed" && python3 -m http.server $PORT --bind 127.0.0.1 >/dev/null 2>&1 ) &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
sleep 1

APP="$WORK/Applications/Adar.app"
echo "Installed: $(defaults read "$APP/Contents/Info.plist" CFBundleShortVersionString)"
ADAR_UPDATE_FEED="http://127.0.0.1:$PORT/latest.json" ADAR_UPDATE_TEST_AUTOINSTALL=1 \
  "$APP/Contents/MacOS/Adar" 2>&1 | grep "\[updater-test\]" || true

for i in $(seq 1 40); do
  V="$(defaults read "$APP/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null || echo '?')"
  [ "$V" = "$NEXT" ] && break
  sleep 0.5
done
echo "After update: $V"
sleep 3
if pgrep -f "$APP/Contents/MacOS/Adar" >/dev/null; then echo "Relaunched: yes"; pkill -f "$APP/Contents/MacOS/Adar" || true; else echo "Relaunched: no"; fi
[ "$V" = "$NEXT" ] && echo "UPDATER TEST PASSED" || { echo "UPDATER TEST FAILED"; exit 1; }
