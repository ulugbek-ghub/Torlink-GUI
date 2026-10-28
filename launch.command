#!/bin/bash
# Double-click this file to launch Torlink GUI. It installs/builds when
# needed, starts the server, and opens it in your default browser. The
# Terminal window that opens shows the live server log; close it (Ctrl-C)
# to quit the server.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

URL="http://127.0.0.1:4040"

find_node() {
  if [ -n "${TORLINK_NODE:-}" ] && [ -x "${TORLINK_NODE}" ]; then
    echo "${TORLINK_NODE}"
    return
  fi
  if command -v node >/dev/null 2>&1; then
    command -v node
    return
  fi
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
    if [ -x "$candidate" ]; then
      echo "$candidate"
      return
    fi
  done
}

find_npm() {
  if command -v npm >/dev/null 2>&1; then
    command -v npm
    return
  fi
  local node_dir
  node_dir="$(dirname "$NODE_BIN")"
  for candidate in "$node_dir/npm" "$node_dir/bin/npm"; do
    if [ -x "$candidate" ]; then
      echo "$candidate"
      return
    fi
  done
}

open_browser() {
  if command -v open >/dev/null 2>&1; then
    open "$URL" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL" >/dev/null 2>&1 || true
  fi
}

fail() {
  echo "$1"
  read -r -p "Press Return to close..." _ || true
  exit 1
}

NODE_BIN="$(find_node || true)"
if [ -z "$NODE_BIN" ]; then
  echo "Torlink needs Node.js 22 or newer."
  echo "Install it from https://nodejs.org and run this again."
  read -r -p "Press Return to close..." _ || true
  exit 1
fi

NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
case "$NODE_MAJOR" in
  ''|*[!0-9]*) NODE_MAJOR=0 ;;
esac
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "Torlink needs Node.js 22 or newer (found $("$NODE_BIN" -v 2>/dev/null))."
  echo "Install it from https://nodejs.org and run this again."
  read -r -p "Press Return to close..." _ || true
  exit 1
fi

NPM_BIN="$(find_npm || true)"

if [ ! -f "node_modules/torlnk/dist/cli.cjs" ] || [ ! -d "node_modules/express" ]; then
  if [ -z "$NPM_BIN" ]; then
    echo "npm was not found. Install Node.js 22 or newer from https://nodejs.org."
    read -r -p "Press Return to close..." _ || true
    exit 1
  fi
  echo "Installing dependencies..."
  if ! "$NPM_BIN" install --no-audit --no-fund; then
    fail "Installing dependencies failed. Check the messages above."
  fi
fi

if [ ! -f "dist/index.html" ] || find src server -type f ! -name .DS_Store -newer dist/index.html 2>/dev/null | grep -q .; then
  echo "Building frontend..."
  if ! "$NPM_BIN" run build; then
    fail "Building the interface failed. Check the messages above."
  fi
fi

# If a server is already running, just open the browser and exit.
if curl -sf -m 2 "$URL/api/health" >/dev/null 2>&1; then
  echo "Torlink GUI is already running on $URL"
  open_browser
  exit 0
fi

echo "Starting Torlink GUI on $URL ..."
"$NODE_BIN" server/index.js &
SERVER_PID=$!

cleanup() {
  if kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup INT TERM EXIT

# Wait until the API is healthy, then open the browser.
STARTED=0
for _ in $(seq 1 60); do
  if curl -sf -m 2 "$URL/api/health" >/dev/null 2>&1; then
    STARTED=1
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    break
  fi
  sleep 0.5
done

if [ "$STARTED" -ne 1 ]; then
  echo "Torlink did not start. Check the messages above."
  exit 1
fi

open_browser

# Keep this shell (and the server) alive until the user closes the window.
wait "$SERVER_PID" || true
