#!/bin/bash
# AppyStack — Dev Server Launcher
cd "$(dirname "$0")/.."

ENV_FILE=".env"

# ── Helpers ─────────────────────────────────────────────────────────────────

env_val()        { grep "^$1=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"'; }
port_of_url()    { echo "$1" | grep -oE '[0-9]+$'; }
pid_on_port()    { lsof -ti ":$1" 2>/dev/null || true; }
proc_on_port()   { lsof -i ":$1" 2>/dev/null | grep LISTEN | awk '{print $1" (pid "$2")"}' | head -1; }

# ── Validate .env ────────────────────────────────────────────────────────────

if [[ ! -f "$ENV_FILE" ]]; then
  if [[ -f ".env.example" ]]; then
    echo "No .env found — creating one from .env.example ..."
    cp .env.example "$ENV_FILE"
    echo ""
  else
    echo "ERROR: No .env or .env.example file found."
    exit 1
  fi
fi

SERVER_PORT=$(env_val PORT)
CLIENT_URL=$(env_val CLIENT_URL)
CLIENT_PORT=$(port_of_url "$CLIENT_URL")

if [[ -z "$SERVER_PORT" || -z "$CLIENT_PORT" ]]; then
  echo "ERROR: Could not read PORT or CLIENT_URL from .env"
  exit 1
fi

# ── Banner ───────────────────────────────────────────────────────────────────

echo ""
echo "══════════════════════════════════════════════"
echo "  AppyStack — Dev Server"
echo "  client: http://localhost:${CLIENT_PORT}  server: http://localhost:${SERVER_PORT}"
echo "══════════════════════════════════════════════"
echo ""

# ── Warn on shell PORT conflict ──────────────────────────────────────────────

if [[ -n "${PORT:-}" && "$PORT" != "$SERVER_PORT" ]]; then
  echo "WARNING: Shell has PORT=$PORT but .env says PORT=$SERVER_PORT"
  echo "  env.ts enables dotenv override at runtime so .env wins — but check your shell config."
  echo ""
fi

# ── Port conflict check: server ──────────────────────────────────────────────

SERVER_PID=$(pid_on_port "$SERVER_PORT")
if [[ -n "$SERVER_PID" ]]; then
  PROC=$(proc_on_port "$SERVER_PORT")
  echo "Port $SERVER_PORT is in use by: ${PROC:-pid $SERVER_PID}"
  echo ""
  echo "  [1] Kill it and start fresh"
  echo "  [2] Open browser (assume already running)"
  echo "  [3] Abort"
  echo ""
  read -rp "Choice [1/2/3]: " choice
  case "${choice:-3}" in
    1)
      echo "Killing :$SERVER_PORT ..."
      echo "$SERVER_PID" | xargs kill -9 2>/dev/null || true
      sleep 0.5
      ;;
    2)
      open "http://localhost:${CLIENT_PORT}"
      exit 0
      ;;
    *)
      echo "Aborted."
      exit 0
      ;;
  esac
fi

# ── Port conflict check: client ──────────────────────────────────────────────

CLIENT_PID=$(pid_on_port "$CLIENT_PORT")
if [[ -n "$CLIENT_PID" ]]; then
  PROC=$(proc_on_port "$CLIENT_PORT")
  echo "Port $CLIENT_PORT is in use by: ${PROC:-pid $CLIENT_PID}"
  echo ""
  read -rp "Kill it and continue? [y/N]: " confirm
  if [[ "${confirm:-n}" =~ ^[Yy]$ ]]; then
    echo "$CLIENT_PID" | xargs kill -9 2>/dev/null || true
    sleep 0.5
  else
    echo "Aborted."
    exit 0
  fi
fi

# ── Build shared ─────────────────────────────────────────────────────────────

echo "Building shared types..."
npm run build -w shared
echo ""

# ── Self-heal: clear a stale Overmind socket ────────────────────────────────
# A crashed or force-killed session leaves .overmind.sock behind. Overmind then
# refuses to start ("it looks like Overmind is already running") even though
# nothing is. Detect that case and clean it, so start.sh is recoverable.

if [[ -e .overmind.sock ]]; then
  # `overmind status` exits 0 as long as the daemon answers — even when every
  # managed process has died. So check the STATUS column for an actually-running
  # process, not just the exit code, or a zombie session looks "already running".
  if overmind status 2>/dev/null | grep -qw running; then
    echo "Overmind is already running for this project."
    echo "  overmind connect server   — attach to logs"
    echo "  overmind stop             — stop all processes"
    echo ""
    echo "Opening browser..."
    open "http://localhost:${CLIENT_PORT}"
    exit 0
  fi
  # Sock present but nothing running → dead/stale session. Shut the daemon down
  # cleanly (so it doesn't linger as an orphan) and clear the socket, then start.
  echo "Found a dead/stale Overmind session — cleaning it up..."
  overmind quit >/dev/null 2>&1 || true
  rm -f .overmind.sock
  echo ""
fi

# ── Launch ───────────────────────────────────────────────────────────────────

echo "Starting via Overmind..."
echo "  overmind connect client  — attach to client logs"
echo "  overmind connect server  — attach to server logs"
echo "  overmind stop            — stop all processes"
echo ""

# Open browser once server health check passes (background)
(
  for _ in {1..15}; do
    sleep 1
    if curl -sf "http://localhost:${SERVER_PORT}/health" > /dev/null 2>&1; then
      open "http://localhost:${CLIENT_PORT}"
      break
    fi
  done
) &

overmind start
