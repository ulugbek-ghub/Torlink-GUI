#!/bin/bash
# Headless launcher for Torlink GUI. Used by Torlink.app and launch.command.
# Installs missing dependencies, builds the frontend when stale, starts the
# server if it isn't running, then opens the app in your default browser.
# No terminal window is needed.
set -u

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR" || exit 1

LOG="${TMPDIR:-/tmp}/torlink-gui.log"
URL="http://127.0.0.1:4040"

notify() {
  local message="$1"
  echo "[torlink-gui] $message" >> "$LOG"
  if command -v osascript >/dev/null 2>&1; then
    osascript -e "display alert \"Torlink\" message \"$message\"" >/dev/null 2>&1 || true
  fi
}

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

NODE_BIN="$(find_node || true)"
if [ -z "$NODE_BIN" ]; then
  notify "Torlink needs Node.js 22 or newer. Install it from nodejs.org and try again."
  exit 1
fi

NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
case "$NODE_MAJOR" in
  ''|*[!0-9]*) NODE_MAJOR=0 ;;
esac
if [ "$NODE_MAJOR" -lt 22 ]; then
  notify "Torlink needs Node.js 22 or newer (found $("$NODE_BIN" -v 2>/dev/null)). Install it from nodejs.org and try again."
  exit 1
fi

NPM_BIN="$(find_npm || true)"

# 1. Install dependencies when the bundled torlnk package is missing.
if [ ! -f "node_modules/torlnk/dist/cli.cjs" ] || [ ! -d "node_modules/express" ]; then
  if [ -z "$NPM_BIN" ]; then
    notify "npm was not found. Install Node.js 22 or newer from nodejs.org and try again."
    exit 1
  fi
  echo "[torlink-gui] Installing dependencies..." >> "$LOG"
  if ! "$NPM_BIN" install --no-audit --no-fund >> "$LOG" 2>&1; then
    notify "Torlink could not install its dependencies. See $LOG"
    exit 1
  fi
fi

# 2. Build the frontend if missing or stale.
if [ ! -f "dist/index.html" ] || find src server -type f ! -name .DS_Store -newer dist/index.html 2>/dev/null | grep -q .; then
  if [ -z "$NPM_BIN" ]; then
    notify "npm was not found. Install Node.js 22 or newer from nodejs.org and try again."
    exit 1
  fi
  echo "[torlink-gui] Building frontend..." >> "$LOG"
  if ! "$NPM_BIN" run build >> "$LOG" 2>&1; then
    notify "Torlink could not build its interface. See $LOG"
    exit 1
  fi
fi

# 3. Start the server if nothing is answering on :4040 yet.
if ! curl -sf -m 2 "$URL/api/health" >/dev/null 2>&1; then
  echo "[torlink-gui] Starting server..." >> "$LOG"
  nohup "$NODE_BIN" server/index.js >> "$LOG" 2>&1 &
  echo $! > "${TMPDIR:-/tmp}/torlink-gui.pid" 2>/dev/null || true
fi

# 4. Wait for the API, then open the browser.
STARTED=0
for _ in $(seq 1 60); do
  if curl -sf -m 2 "$URL/api/health" >/dev/null 2>&1; then
    STARTED=1
    break
  fi
  sleep 0.5
done

if [ "$STARTED" -ne 1 ]; then
  notify "Torlink did not start. See $LOG"
  exit 1
fi

if command -v open >/dev/null 2>&1; then
  open "$URL" >/dev/null 2>&1 || true
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL" >/dev/null 2>&1 || true
fi
