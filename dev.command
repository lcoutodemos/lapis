#!/usr/bin/env bash
# AFFiNE dev launcher — run from the repo root: ./dev.sh
# Ctrl-C stops everything cleanly.
#
# Renderer errors: open Chrome → chrome://inspect → click "inspect" on the renderer target

set -euo pipefail

REPO="$(cd "$(dirname "$0")" && pwd)"
TSX="$REPO/node_modules/.bin/tsx"
RENDERER_LOG="$REPO/dev-renderer.log"
ELECTRON_LOG="$REPO/dev-electron.log"
DEV_SERVER_URL="http://localhost:8080"

# ── cleanup on exit ──────────────────────────────────────────────────────────
cleanup() {
  echo ""
  echo "[dev] shutting down..."
  kill "$RENDERER_PID" "$ELECTRON_PID" 2>/dev/null || true
  wait 2>/dev/null || true
  echo "[dev] done."
}
trap cleanup EXIT INT TERM

# ── kill stale instances ─────────────────────────────────────────────────────
echo "[dev] killing stale processes..."
# Kill any Electron using our userData dir (covers both old AFFiNE/ and new lapis/ paths)
pkill -f "@affine/electron" 2>/dev/null || true
# Also kill stale renderer/electron dev processes from either path
pkill -f "affine.ts bundle.*electron-renderer" 2>/dev/null || true
pkill -f "scripts/dev.ts" 2>/dev/null || true
sleep 0.5

# ── start renderer dev server ────────────────────────────────────────────────
echo "[dev] starting renderer → $RENDERER_LOG"
"$TSX" "$REPO/tools/cli/src/affine.ts" bundle \
  --package @affine/electron-renderer \
  --dev \
  >"$RENDERER_LOG" 2>&1 &
RENDERER_PID=$!

echo "[dev] waiting for renderer on $DEV_SERVER_URL ..."
for i in $(seq 1 60); do
  if curl -s --max-time 1 "$DEV_SERVER_URL" -o /dev/null 2>/dev/null; then
    echo "[dev] renderer ready after ${i}s"
    break
  fi
  if ! kill -0 "$RENDERER_PID" 2>/dev/null; then
    echo "[ERROR] renderer died — last 30 lines of $RENDERER_LOG:"
    tail -30 "$RENDERER_LOG"
    exit 1
  fi
  sleep 1
done

# ── start electron ───────────────────────────────────────────────────────────
echo "[dev] starting Electron (remote-debugging on port 9222) → $ELECTRON_LOG"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  To inspect renderer JS errors:"
echo "    Open Chrome → chrome://inspect → click 'inspect' on AFFiNE"
echo ""
echo "  Log files:"
echo "    Renderer → $RENDERER_LOG"
echo "    Electron → $ELECTRON_LOG"
echo ""
echo "  Ctrl-C to stop everything."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

(
  cd "$REPO/packages/frontend/apps/electron"
  DEV_SERVER_URL="$DEV_SERVER_URL" \
  NODE_ENV=development \
    "$TSX" scripts/dev.ts 2>&1
) | grep -v 'ERR_FILE_NOT_FOUND' | tee "$ELECTRON_LOG" &
ELECTRON_PID=$!

wait "$ELECTRON_PID"
