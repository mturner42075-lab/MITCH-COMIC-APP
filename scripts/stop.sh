#!/usr/bin/env bash
set -euo pipefail

ROOT="/Users/mitchturner/Documents/New project"
PID_DIR="$ROOT/.pids"

if [ -f "$PID_DIR/api.pid" ]; then
  kill "$(cat "$PID_DIR/api.pid")" >/dev/null 2>&1 || true
  rm -f "$PID_DIR/api.pid"
fi

if [ -f "$PID_DIR/web.pid" ]; then
  kill "$(cat "$PID_DIR/web.pid")" >/dev/null 2>&1 || true
  rm -f "$PID_DIR/web.pid"
fi

pkill -f "node src/index.js" >/dev/null 2>&1 || true
pkill -f "react-scripts start" >/dev/null 2>&1 || true

echo "Stopped." 
