#!/usr/bin/env bash
# End-to-end test of the in-app updater with real packaged builds (macOS, takes a few minutes):
#   1. package Adar <base> (.app) and install it into <work>/Applications
#   2. package Adar <next> as a .zip and serve a fake "latest release" feed for it on 127.0.0.1
#   3. launch the installed app with ADAR_UPDATE_FEED + ADAR_UPDATE_TEST_AUTOINSTALL=1
#   4. expect the bundle to be replaced by <next> and relaunched, the previous bundle kept as
#      Adar.app.adar-old until the new version has started, then removed by it
# The test bundles get their own app name and bundle id, so they never use (or lock) your real Adar
# profile (~/Library/Application Support/Adar) and LaunchServices keeps them apart from an installed Adar.
# Usage: scripts/test-updater.sh <workdir> [base=0.0.1] [next=0.0.2]
set -euo pipefail
cd "$(dirname "$0")/.."
WORK="$1"; BASE="${2:-0.0.1}"; NEXT="${3:-0.0.2}"
ARCH="$(uname -m)"; [ "$ARCH" = "x86_64" ] && ARCH=x64
TEST_NAME="Adar Updater Test"             # package.json productName → app.name → userData dir + single-instance lock
TEST_APP_ID="dev.adar.gitclient.updatertest"
TEST_PROFILE="$HOME/Library/Application Support/$TEST_NAME"
rm -rf "$WORK"; mkdir -p "$WORK/Applications" "$WORK/feed"
export CSC_IDENTITY_AUTO_DISCOVERY=false

SERVER=""
APP="$WORK/Applications/Adar.app"
cleanup() {
  [ -n "$SERVER" ] && kill "$SERVER" 2>/dev/null || true
  pkill -f "$APP/Contents/MacOS/" 2>/dev/null || true
  # build() baked the test version into out/: leave a normal build behind.
  ./node_modules/.bin/electron-vite build >/dev/null 2>&1 || echo "warning: could not rebuild out/ (run npm run build)"
  rm -rf "$TEST_PROFILE"
}
trap cleanup EXIT

build() { # version target outdir
  ADAR_VERSION_OVERRIDE="$1" ./node_modules/.bin/electron-vite build >/dev/null
  ./node_modules/.bin/electron-builder --mac "$2" "--$ARCH" --publish never \
    -c.extraMetadata.version="$1" -c.extraMetadata.productName="$TEST_NAME" -c.appId="$TEST_APP_ID" \
    -c.directories.output="$3" >/dev/null
}

echo "Building base $BASE…"
build "$BASE" dir "$WORK/build-base"
cp -R "$WORK/build-base/mac-$ARCH/Adar.app" "$WORK/Applications/" 2>/dev/null || cp -R "$WORK"/build-base/mac*/Adar.app "$WORK/Applications/"

echo "Building next $NEXT…"
build "$NEXT" zip "$WORK/build-next"
ZIP="$(ls "$WORK"/build-next/*.zip | head -1)"
cp "$ZIP" "$WORK/feed/"
NAME="$(basename "$ZIP")"; SIZE="$(stat -f %z "$ZIP")"
# A free port (a fixed one could be held by a stale server from an earlier run, serving an old feed).
PORT="$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')"
# No "digest" here, like assets uploaded before GitHub computed them: the updater falls back to the size.
cat > "$WORK/feed/latest.json" <<JSON
{"tag_name":"v$NEXT","name":"Adar $NEXT","body":"Test release","html_url":"https://example.invalid","published_at":"2026-10-20T00:00:00Z","draft":false,"prerelease":false,
 "assets":[{"name":"$NAME","browser_download_url":"http://127.0.0.1:$PORT/$NAME","size":$SIZE}]}
JSON
( cd "$WORK/feed" && exec python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 ) &
SERVER=$!
disown "$SERVER" 2>/dev/null || true   # no "Terminated" job message when the trap stops it
for i in $(seq 1 20); do curl -sf "http://127.0.0.1:$PORT/latest.json" >/dev/null && break; sleep 0.25; done
curl -sf "http://127.0.0.1:$PORT/latest.json" >/dev/null || { echo "Could not start the feed server on port $PORT"; exit 1; }

echo "Installed: $(defaults read "$APP/Contents/Info.plist" CFBundleShortVersionString) ($(defaults read "$APP/Contents/Info.plist" CFBundleIdentifier))"
ADAR_UPDATE_FEED="http://127.0.0.1:$PORT/latest.json" ADAR_UPDATE_TEST_AUTOINSTALL=1 \
  "$APP/Contents/MacOS/Adar" 2>&1 | grep "\[updater-test\]" || true

V='?'
for i in $(seq 1 40); do
  V="$(defaults read "$APP/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null || echo '?')"
  [ "$V" = "$NEXT" ] && break
  sleep 0.5
done
echo "After update: $V"
BACKUP_KEPT=no; [ -d "$APP.adar-old" ] && BACKUP_KEPT=yes
echo "Previous bundle kept until the new version starts: $BACKUP_KEPT"
sleep 3
RELAUNCHED=no; pgrep -f "$APP/Contents/MacOS/Adar" >/dev/null && RELAUNCHED=yes
echo "Relaunched: $RELAUNCHED"
CLEANED=no
for i in $(seq 1 60); do
  [ ! -e "$APP.adar-old" ] && { CLEANED=yes; break; }
  sleep 0.5
done
echo "Previous bundle removed by the new version: $CLEANED"
pkill -f "$APP/Contents/MacOS/Adar" || true
if [ "$V" = "$NEXT" ] && [ "$RELAUNCHED" = yes ] && [ "$BACKUP_KEPT" = yes ] && [ "$CLEANED" = yes ]; then
  echo "UPDATER TEST PASSED"
else
  echo "UPDATER TEST FAILED"; exit 1
fi
