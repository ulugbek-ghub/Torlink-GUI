#!/bin/bash
# Headless launcher for Torlink GUI. Used by Torlink.app and launch.command.
# Builds the frontend when stale, starts the server if it isn't running,
# then opens the app in your default browser. No terminal window needed.
set -u

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR" || exit 1

LOG="${TMPDIR:-/tmp}/torlink-gui.log"

# 1. Install dependencies if missing.
if [ ! -d "node_modules" ]; then
  echo "[torlink-gui] Installing dependencies…" >> "$LOG"
  npm install >> "$LOG" 2>&1
fi

# 2. Build the frontend if missing or stale.
if [ ! -d "dist" ] || find src server -type f ! -name .DS_Store -newer dist/index.html 2>/dev/null | grep -q .; then
  echo "[torlink-gui] Building frontend…" >> "$LOG"
  npm run build >> "$LOG" 2>&1
fi

# 3. Start the server if nothing is listening on :4040 yet.
if ! curl -sf -m 2 http://127.0.0.1:4040/api/health >/dev/null 2>&1; then
  echo "[torlink-gui] Starting server…" >> "$LOG"
  nohup npm start >> "$LOG" 2>&1 &
fi

# 4. Wait for the API, then open the browser.
for i in $(seq 1 40); do
  if curl -sf -m 2 http://127.0.0.1:4040/api/health >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

open http://localhost:4040 || true
