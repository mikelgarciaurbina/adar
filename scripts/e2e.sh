#!/usr/bin/env bash
# Scripted end-to-end run of the REAL Electron app with screenshots (development only).
#
#   scripts/e2e.sh <workdir> <steps.json> [--no-build]
#
# - Builds the app into <workdir>/out (isolated, so several runs can happen in parallel).
# - Uses <workdir>/ud as the user-data dir (put a settings.json there, e.g.
#   {"openTabs":["/abs/repo"],"activeTab":"/abs/repo","autoFetchMinutes":0}).
# - Screenshots go to <workdir>/shots/<name>.png; js step results are printed as "[capture] js → …".
# Steps format (see runCaptureSteps in src/main/index.ts):
#   [{"size":[1440,900]}, {"wait":3000}, {"js":"document.title"}, {"shot":"01-main"}]
# In js steps, window.__adar exposes { store (zustand useApp), api } for inspection.
set -euo pipefail
cd "$(dirname "$0")/.."
WORK="$1"; STEPS="$2"; MODE="${3:-}"
mkdir -p "$WORK/ud" "$WORK/shots"
if [ "$MODE" != "--no-build" ]; then
  ./node_modules/.bin/electron-vite build --outDir "$WORK/out" >"$WORK/build.log" 2>&1 || { tail -30 "$WORK/build.log"; exit 1; }
fi
ADAR_USER_DATA="$WORK/ud" ADAR_CAPTURE_STEPS="$STEPS" ADAR_CAPTURE_DIR="$WORK/shots" \
  ./node_modules/.bin/electron "$WORK/out/main/index.js" 2>&1 | grep -E "^\[capture\]|Error|error" &
PID=$!
( sleep "${E2E_TIMEOUT:-180}"; pkill -f "$WORK/out/main/index.js" 2>/dev/null ) &
WATCHDOG=$!
wait $PID || true
kill $WATCHDOG 2>/dev/null || true
