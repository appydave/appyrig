#!/usr/bin/env bash
# P6 prep by-effect probe: install a lane-test hub launchd job, prove it, always uninstall.
# Usage: server/scripts/hub-service-probe.sh [port]   (default 7300 = the hub lane client port)
# Never touches the real label. Always uninstalls, even on failure. Scratch files go to a mktemp dir.
set -uo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"; S="$(mktemp -d)"; port=${1:-7300}
L=com.appydave.appyrig.hub.lane-test; H="$repo/server/scripts/hub-service.sh"; U=gui/$(id -u)
OPTS=(--label $L --port $port --bind 127.0.0.1,::1 --token-file "$S/svc-token" --data-dir "$S/svc-data")
LOG=~/Library/Logs/$L.log; rm -f "$LOG"
lsof -nP -iTCP:$port -sTCP:LISTEN && { echo "port $port busy"; exit 1; }
openssl rand -hex 24 > "$S/svc-token"; chmod 600 "$S/svc-token"; T=$(cat "$S/svc-token")
trap '"$H" uninstall "${OPTS[@]}" >/dev/null 2>&1; rm -rf "$S"' EXIT
pid() { launchctl print $U/$L 2>/dev/null | awk '/^\tpid =/{print $3}'; }
B=http://127.0.0.1:$port
echo "--- install"; "$H" install "${OPTS[@]}" || exit 1; sleep 3; "$H" status "${OPTS[@]}"
echo "--- launchctl list"; launchctl list | grep "$L"
echo "--- health (open)"; curl -s -w "\n" $B/v1/health
echo "--- built UI behind the gate"
curl -s -o /dev/null -w "/ unauth %{http_code}\n" $B/
curl -s -c "$S/svc-jar" -o /dev/null -w "login %{http_code} -> %{redirect_url}\n" "$B/?token=$T"
curl -s -b "$S/svc-jar" -o "$S/svc-index.html" -w "/ with cookie %{http_code}\n" $B/
A=$(grep -o 'src="/assets/[^"]*"' "$S/svc-index.html" | head -1 | cut -d'"' -f2)
curl -s -b "$S/svc-jar" -o /dev/null -w "$A with cookie %{http_code}\n" $B$A
curl -s -o /dev/null -w "$A unauth %{http_code}\n" $B$A
echo "--- built UI in Chromium (socket under production CSP)"
node "$repo/server/scripts/fake-collector.mjs" --hub $B --token "$T" --scenario roamy --once >/dev/null 2>&1 && echo "fake collector pushed roamy"
node "$repo/server/scripts/hub-ui-probe.mjs" $B "$T"
echo "--- plist wins over the repo .env (PORT=7301, NODE_ENV=development there)"
grep -o 'Hub listening on [^"]*' "$LOG" | tail -1; grep -c '"level"' "$LOG" | sed 's/^/JSON (production) log lines: /'
echo "token in log: $(grep -c "$T" "$LOG")"
echo "--- kill -9 relaunch"; P1=$(pid); kill -9 "$P1"; for i in $(seq 1 20); do sleep 1; P2=$(pid); [[ -n "$P2" && "$P2" != "$P1" ]] && curl -sf $B/v1/health >/dev/null && break; done
echo "pid $P1 -> $P2 after ${i}s"; curl -s -w "\n" $B/v1/health
echo "--- uninstall"; "$H" uninstall "${OPTS[@]}"; trap - EXIT
ls ~/Library/LaunchAgents/$L.plist 2>/dev/null || echo "plist gone"
launchctl list | grep -q "$L" && echo "STILL LOADED" || echo "not in launchctl list"
lsof -nP -iTCP:$port -sTCP:LISTEN >/dev/null && echo "PORT STILL BOUND" || echo "port $port free"
rm -rf "$S" "$LOG"
