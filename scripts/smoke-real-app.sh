#!/usr/bin/env bash
# smoke-real-app.sh: run the real, built hub once and check that it serves and takes a push.
#
#   scripts/smoke-real-app.sh [--port <n>] [--no-build]
#
# 1. builds the bundle the hub serves (server/dist + client/dist; shared must already be built)
# 2. starts the hub on a spare port (default 7391) with a throwaway DATA_DIR and token file
# 3. checks /health answers and / serves the built client/dist/index.html
# 4. sends one fake collector push (m2 scenario) and checks it is acked
# 5. stops the hub (only the PID this script started) and removes the temp folder
#
# Never touches the live hub: 7191 is refused, a busy port is refused, and the repo .env is ignored
# (HUB_IGNORE_DOTENV=1), so nothing here reads or writes real data/. Runs in CI (ci.yml) and locally.
set -euo pipefail

port="${SMOKE_PORT:-7391}"
build=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) port="$2"; shift 2 ;;
    --no-build) build=0; shift ;;
    *) echo "smoke: unknown option $1" >&2; exit 2 ;;
  esac
done

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"
base="http://127.0.0.1:$port"
started=$SECONDS
step() { printf '[smoke %3ss] %s\n' "$((SECONDS - started))" "$*"; }
fail() { printf '[smoke] FAIL: %s\n' "$*" >&2; [[ -f "${tmp:-}/hub.log" ]] && tail -40 "$tmp/hub.log" >&2; exit 1; }

[[ "$port" == 7191 ]] && fail "port 7191 is the live hub; pick another"
# Busy if anything answers on it over IPv4 or IPv6 (a bind test misses a server on ::1 only).
if node -e '
  const net = require("net"), port = +process.argv[1];
  const probe = (host) => new Promise((r) => {
    const c = net.connect({ host, port }, () => { c.destroy(); r(true); });
    c.on("error", () => r(false)); c.setTimeout(500, () => { c.destroy(); r(false); });
  });
  Promise.all(["127.0.0.1", "::1"].map(probe)).then((up) => process.exit(up.some(Boolean) ? 1 : 0));
' "$port"; then :
else fail "port $port is in use; pass --port <spare port>"; fi

tmproot="${TMPDIR:-/tmp}"
tmp="$(mktemp -d "${tmproot%/}/appyrig-smoke-XXXXXX")"
hub_pid=""
cleanup() {
  if [[ -n "$hub_pid" ]] && kill -0 "$hub_pid" 2>/dev/null; then
    kill "$hub_pid" 2>/dev/null || true
    wait "$hub_pid" 2>/dev/null || true
  fi
  rm -rf "$tmp"
}
trap cleanup EXIT

if [[ "$build" == 1 ]]; then
  step "building server and client (the bundle the hub serves)"
  npm run build -w server >"$tmp/build.log" 2>&1 || { tail -40 "$tmp/build.log" >&2; fail "server build"; }
  NODE_ENV=production npm run build -w client >>"$tmp/build.log" 2>&1 || { tail -40 "$tmp/build.log" >&2; fail "client build"; }
fi
[[ -f server/dist/index.js ]] || fail "server/dist/index.js missing (build first or drop --no-build)"
[[ -f client/dist/index.html ]] || fail "client/dist/index.html missing (build first or drop --no-build)"

mkdir -p "$tmp/data"
( umask 077; node -e 'process.stdout.write(require("crypto").randomBytes(24).toString("hex"))' >"$tmp/token" )
token="$(cat "$tmp/token")"

step "starting the hub on $base (DATA_DIR and token file under $tmp)"
(
  cd server
  exec env -u HUB_TOKEN NODE_ENV=production HUB_IGNORE_DOTENV=1 PORT="$port" HUB_BIND_HOSTS=127.0.0.1 \
    HUB_TOKEN_FILE="$tmp/token" DATA_DIR="$tmp/data" CLIENT_URL="$base" node dist/index.js
) >"$tmp/hub.log" 2>&1 &
hub_pid=$!

for _ in $(seq 1 60); do
  curl -sf "$base/health" >"$tmp/health.json" 2>/dev/null && break
  kill -0 "$hub_pid" 2>/dev/null || fail "the hub exited during start-up"
  sleep 0.25
done
grep -q '"status":"ok"' "$tmp/health.json" 2>/dev/null || fail "/health did not answer ok"
step "/health: $(cat "$tmp/health.json")"

code="$(curl -s -o "$tmp/index.html" -w '%{http_code}' -H "Authorization: Bearer $token" "$base/")"
[[ "$code" == 200 ]] || fail "/ answered HTTP $code"
cmp -s "$tmp/index.html" client/dist/index.html || fail "/ is not the built client/dist/index.html"
step "/: HTTP 200, byte-identical to client/dist/index.html ($(wc -c <"$tmp/index.html" | tr -d ' ') bytes)"

step "one fake collector push (m2)"
node server/scripts/fake-collector.mjs --hub "$base" --token-file "$tmp/token" --scenario m2 --once \
  | tee "$tmp/push.log" || fail "the push was refused"
grep -q '"ok":true' "$tmp/push.log" || fail "the push was not acked ok"

step "stopping the hub (pid $hub_pid)"
kill "$hub_pid"
wait "$hub_pid" 2>/dev/null || true
hub_pid=""
step "PASS"
