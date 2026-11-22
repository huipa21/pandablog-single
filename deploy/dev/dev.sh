#!/usr/bin/env bash
# PandaBlog local development helper (WSL2).
#
# Usage:
#   ./deploy/dev/dev.sh start     # start SurrealDB (if needed) + dev server
#   ./deploy/dev/dev.sh stop      # stop dev server (DB keeps running)
#   ./deploy/dev/dev.sh stop --db # stop dev server AND SurrealDB container
#   ./deploy/dev/dev.sh status    # show dev server / DB / health state
#   ./deploy/dev/dev.sh logs      # tail dev server log
#
# Handles the local gotchas:
#   - pins Node to .node-version (22.22.0) via nvm
#   - clears WSL HTTP(S)_PROXY vars that hijack the ws://127.0.0.1:8000 DB
#     connection (undici does not honour the `127.*` no_proxy glob)
#   - starts/creates the SurrealDB 3.x container named surrealdb-dev
#
# Dev app URL (must match NUXT_APP_ORIGIN in .env):
#   http://localhost:3000        (WSL2 mirrored networking: same URL on Windows)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PID_FILE="/tmp/pandablog-dev.pid"
LOG_FILE="/tmp/pandablog-dev.log"
DB_CONTAINER="surrealdb-dev"
DB_VOLUME="surrealdb-dev-data"
DB_IMAGE="surrealdb/surrealdb:v3.3.5" # repo expects SurrealDB 3.x, NOT latest (4.x)
APP_URL="http://localhost:3000"

die() { echo "ERROR: $*" >&2; exit 1; }

dev_pid() {
  [ -f "$PID_FILE" ] || return 1
  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null)" || return 1
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null || return 1
  echo "$pid"
}

# --- Node: pin to repo version via nvm --------------------------------------
use_repo_node() {
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  [ -s "$NVM_DIR/nvm.sh" ] || die "nvm not found at $NVM_DIR/nvm.sh"
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  local want
  want="$(cat "$ROOT/.node-version")"
  nvm use "$want" >/dev/null 2>&1 || {
    echo "Node $want not installed yet; installing via nvm..."
    nvm install "$want" >/dev/null
    nvm use "$want" >/dev/null
  }
}

# --- Proxy vars: must be cleared before starting the dev server -------------
clear_proxies() {
  unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY all_proxy
}

# --- SurrealDB dev container -------------------------------------------------
ensure_db() {
  if docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
    echo "DB: container '$DB_CONTAINER' already running"
    return
  fi
  if docker ps -a --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
    echo "DB: starting stopped container '$DB_CONTAINER'"
    docker start "$DB_CONTAINER" >/dev/null
  else
    local root_pw
    root_pw="$(sed -n 's/^NUXT_SURREAL_ROOT_PASSWORD="\(.*\)"$/\1/p' "$ROOT/.env")"
    [ -n "$root_pw" ] || die "NUXT_SURREAL_ROOT_PASSWORD missing in $ROOT/.env"
    echo "DB: creating container '$DB_CONTAINER' ($DB_IMAGE)"
    docker run -d --name "$DB_CONTAINER" -p 8000:8000 \
      -v "$DB_VOLUME":/data "$DB_IMAGE" \
      start --user root --pass "$root_pw" --bind 0.0.0.0:8000 >/dev/null
  fi
  local i
  for i in $(seq 1 30); do
    docker ps --filter "name=$DB_CONTAINER" --format '{{.Status}}' | grep -q '(healthy)' && break
    sleep 1
  done
  docker ps --filter "name=$DB_CONTAINER" --format '{{.Status}}' | grep -q '(healthy)' \
    || die "SurrealDB container did not become healthy; check: docker logs $DB_CONTAINER"
  echo "DB: healthy on ws://127.0.0.1:8000/rpc"
}

cmd_start() {
  [ -f "$ROOT/.env" ] || die "missing $ROOT/.env — run: cp .env.example .env (and fill secrets)"
  ensure_db
  if pid="$(dev_pid)"; then
    echo "Dev server already running (PID $pid). Log: $LOG_FILE"
    return
  fi
  use_repo_node
  clear_proxies
  echo "Starting dev server (Node $(node -v))..."
  (cd "$ROOT" && nohup npm run dev >"$LOG_FILE" 2>&1 & echo $! >"$PID_FILE")
  local pid
  pid="$(cat "$PID_FILE")"
  local i
  for i in $(seq 1 60); do
    kill -0 "$pid" 2>/dev/null || break
    curl -s --noproxy '*' -o /dev/null -m 2 "$APP_URL/api/ready" && break
    sleep 2
  done
  if curl -s --noproxy '*' -o /dev/null -m 2 "$APP_URL/api/ready"; then
    echo "Dev server ready: $APP_URL  (PID $pid, log: $LOG_FILE)"
    echo "Admin first-run setup: $APP_URL/admin"
  else
    echo "Dev server not ready yet; it may still be compiling. Log: $LOG_FILE"
    echo "Check manually:  curl --noproxy '*' $APP_URL/api/ready"
  fi
}

cmd_stop() {
  local stop_db="${1:-}"
  if pid="$(dev_pid)"; then
    echo "Stopping dev server (PID $pid)..."
    kill "$pid" 2>/dev/null || true
    local i
    for i in $(seq 1 15); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
    kill -0 "$pid" 2>/dev/null && { echo "force-killing PID $pid"; kill -9 "$pid" 2>/dev/null || true; }
    echo "Dev server stopped."
  else
    echo "Dev server not running."
  fi
  rm -f "$PID_FILE"
  if [ "$stop_db" = "--db" ]; then
    docker stop "$DB_CONTAINER" >/dev/null 2>&1 && echo "DB container '$DB_CONTAINER' stopped." \
      || echo "DB container not running."
  else
    echo "DB container left running (use 'stop --db' to also stop it)."
  fi
}

cmd_status() {
  if pid="$(dev_pid)"; then
    echo "Dev server: RUNNING (PID $pid) — $APP_URL"
  else
    echo "Dev server: not running"
  fi
  docker ps -a --filter "name=$DB_CONTAINER" --format "DB container: {{.Status}} ({{.Image}})" \
    || echo "DB container: not created"
  if pid="$(dev_pid)"; then
    if curl -s --noproxy '*' -o /dev/null -m 2 "$APP_URL/api/ready"; then
      echo "Readiness (/api/ready): OK"
    else
      echo "Readiness (/api/ready): FAIL (still starting, or crashed — see $LOG_FILE)"
    fi
  fi
}

cmd_logs() {
  [ -f "$LOG_FILE" ] || die "no log yet at $LOG_FILE"
  tail -n "${1:-50}" -f "$LOG_FILE"
}

case "${1:-start}" in
  start) cmd_start ;;
  stop) shift; cmd_stop "${1:-}" ;;
  restart) cmd_stop; cmd_start ;;
  status) cmd_status ;;
  logs) shift; cmd_logs "${1:-50}" ;;
  *) echo "Usage: $0 {start|stop [--db]|restart|status|logs [N]}" >&2; exit 1 ;;
esac
