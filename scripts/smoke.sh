#!/bin/sh
set -eu

PROJECT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
BROWSER_BIN=${CHROME_BIN:-}
SCREENSHOT_PATH=${1:-}
VIEWPORT_WIDTH=${2:-1440}
VIEWPORT_HEIGHT=${3:-1000}

if [ -n "$BROWSER_BIN" ] && ! [ -x "$BROWSER_BIN" ]; then
  BROWSER_BIN=$(command -v "$BROWSER_BIN" 2>/dev/null || true)
fi

if [ -z "$BROWSER_BIN" ]; then
  for candidate in chromium chromium-browser google-chrome google-chrome-stable; do
    found=$(command -v "$candidate" 2>/dev/null || true)
    if [ -n "$found" ]; then
      BROWSER_BIN=$found
      break
    fi
  done
fi

if [ -z "$BROWSER_BIN" ]; then
  for candidate in \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "/Applications/Chromium.app/Contents/MacOS/Chromium" \
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"; do
    if [ -x "$candidate" ]; then
      BROWSER_BIN=$candidate
      break
    fi
  done
fi

if [ -z "$BROWSER_BIN" ]; then
  echo "smoke SKIP: Chrome/Chromium was not found (set CHROME_BIN to enable)"
  exit 0
fi

SMOKE_DIR=$(mktemp -d "${TMPDIR:-/tmp}/tb03-smoke.XXXXXX")
SERVER_PID=""
BROWSER_PID=""
cleanup() {
  if [ -n "$BROWSER_PID" ]; then
    kill "$BROWSER_PID" 2>/dev/null || true
    wait "$BROWSER_PID" 2>/dev/null || true
  fi
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$SMOKE_DIR"
}
trap cleanup EXIT HUP INT TERM

PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')
DEBUG_PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')
python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$PROJECT_ROOT" >"$SMOKE_DIR/server.log" 2>&1 &
SERVER_PID=$!

attempt=0
until python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:$PORT/', timeout=0.4).read(16)" >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 40 ] || ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "smoke FAIL: local HTTP server did not start"
    sed -n '1,120p' "$SMOKE_DIR/server.log"
    exit 1
  fi
  sleep 0.1
done

"$BROWSER_BIN" \
  --headless \
  --disable-gpu \
  --disable-extensions \
  --disable-background-networking \
  --disable-default-apps \
  --no-first-run \
  --autoplay-policy=no-user-gesture-required \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port="$DEBUG_PORT" \
  --user-data-dir="$SMOKE_DIR/profile" \
  about:blank >"$SMOKE_DIR/browser.out" 2>"$SMOKE_DIR/browser.log" &
BROWSER_PID=$!

if ! node "$PROJECT_ROOT/scripts/chromium-smoke.mjs" \
  "$DEBUG_PORT" \
  "http://127.0.0.1:$PORT/?smoke=1" \
  "$SCREENSHOT_PATH" \
  "$VIEWPORT_WIDTH" \
  "$VIEWPORT_HEIGHT"; then
  echo "smoke FAIL: browser log follows"
  sed -n '1,160p' "$SMOKE_DIR/browser.log"
  exit 1
fi

echo "smoke OK: browser booted, edited, started, and stopped without an uncaught error"
