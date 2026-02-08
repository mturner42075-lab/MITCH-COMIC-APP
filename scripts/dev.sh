#!/usr/bin/env bash
set -euo pipefail

ROOT="/Users/mitchturner/Documents/New project"
API_LOG="$ROOT/backend/api.log"
WEB_LOG="$ROOT/frontend/web.log"
PID_DIR="$ROOT/.pids"

mkdir -p "$PID_DIR"

if curl -s http://127.0.0.1:4000/api/health >/dev/null 2>&1; then
  echo "API already running."
else
  echo "Starting API..."
  (cd "$ROOT/backend" && nohup node src/index.js > "$API_LOG" 2>&1 & echo $! > "$PID_DIR/api.pid")
fi

if pgrep -f "react-scripts start" >/dev/null 2>&1; then
  echo "Web already running."
else
  echo "Starting web..."
  (cd "$ROOT/frontend" && HOST=127.0.0.1 BROWSER=none nohup ./node_modules/.bin/react-scripts start > "$WEB_LOG" 2>&1 & echo $! > "$PID_DIR/web.pid")
fi

for i in {1..10}; do
  if curl -s http://127.0.0.1:4000/api/health >/dev/null 2>&1 && curl -s http://127.0.0.1:3000 >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "API: http://127.0.0.1:4000/api/health"
echo "Web: http://127.0.0.1:3000"
echo "Logs:"
echo "  $API_LOG"
echo "  $WEB_LOG"
