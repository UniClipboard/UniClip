#!/usr/bin/env bash
set -euo pipefail

PORT=8081
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
LOG_DIR="$PROJECT_ROOT/logs"
LOG_FILE="$LOG_DIR/expo-start.log"

find_port_pids() {
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -Fp 2>/dev/null | sed -n 's/^p//p' | sort -u || true
}

process_cwd() {
  lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1 || true
}

assert_current_project_processes() {
  for pid in "$@"; do
    local cwd
    cwd="$(process_cwd "$pid")"
    if [ "$cwd" != "$PROJECT_ROOT" ]; then
      echo "Port $PORT is already in use by another process (pid $pid)." >&2
      [ -n "$cwd" ] && echo "Process directory: $cwd" >&2
      echo "Stop that process first, then run npm run start:clear again." >&2
      exit 1
    fi
  done
}

stop_existing_project_server() {
  local pids
  pids="$(find_port_pids)"
  [ -z "$pids" ] && return 0

  assert_current_project_processes $pids

  echo "Stopping existing Expo server on port $PORT..."
  for pid in $pids; do
    if ! kill "$pid"; then
      echo "Could not stop existing Expo server (pid $pid)." >&2
      echo "Stop it manually, then run npm run start:clear again." >&2
      exit 1
    fi
  done

  local deadline=$((SECONDS + 10))
  while [ -n "$(find_port_pids)" ] && [ "$SECONDS" -lt "$deadline" ]; do
    sleep 0.2
  done

  local remaining
  remaining="$(find_port_pids)"
  if [ -n "$remaining" ]; then
    assert_current_project_processes $remaining
    echo "Existing server did not stop cleanly; forcing it to close..."
    for pid in $remaining; do
      if ! kill -9 "$pid"; then
        echo "Could not force-stop existing Expo server (pid $pid)." >&2
        echo "Stop it manually, then run npm run start:clear again." >&2
        exit 1
      fi
    done
    deadline=$((SECONDS + 10))
    while [ -n "$(find_port_pids)" ] && [ "$SECONDS" -lt "$deadline" ]; do
      sleep 0.2
    done
  fi

  remaining="$(find_port_pids)"
  if [ -n "$remaining" ]; then
    echo "Port $PORT is still busy. Could not start Expo on the required port." >&2
    exit 1
  fi
}

mkdir -p "$LOG_DIR"
stop_existing_project_server

cd "$PROJECT_ROOT"
RCT_METRO_PORT="$PORT" npx expo start --clear --port "$PORT" 2>&1 | tee -a "$LOG_FILE"
