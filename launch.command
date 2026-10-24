#!/bin/bash
# Double-click this file to launch Torlink GUI. It installs/builds when
# needed, starts the server, and opens it in your default browser. The
# Terminal window that opens shows the live server log; close it (Ctrl-C)
# to quit the server.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

if [ ! -d "node_modules" ]; then
  echo "Installing dependencies…"
  npm install
fi

if [ ! -d "dist" ] || find src server -type f ! -name .DS_Store -newer dist/index.html 2>/dev/null | grep -q .; then
  echo "Building frontend…"
  npm run build
fi

# If a server is already running, just open the browser and exit.
if curl -sf -m 2 http://127.0.0.1:4040/api/health >/dev/null 2>&1; then
  echo "Torlink GUI is already running on http://localhost:4040"
  open http://localhost:4040 || true
  exit 0
fi

echo "Starting Torlink GUI on http://localhost:4040 …"
npm start &
SERVER_PID=$!

# Wait until the API is healthy, then open the browser.
for i in $(seq 1 40); do
  if curl -sf -m 2 http://127.0.0.1:4040/api/health >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

open http://localhost:4040 || true

# Keep this shell (and the server) alive until the user closes the window.
wait $SERVER_PID
