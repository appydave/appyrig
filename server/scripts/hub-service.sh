#!/usr/bin/env bash
# hub-service.sh — run the AppyRig hub as a launchd agent (plan §10 P6, review M8).
#
#   server/scripts/hub-service.sh install   [options]   write the plist and load it
#   server/scripts/hub-service.sh uninstall [options]   unload it and remove the plist
#   server/scripts/hub-service.sh status    [options]   what launchd says about it
#   server/scripts/hub-service.sh plist     [options]   print the plist it would write (no side effects)
#
# Options (defaults are the real M2 hub; override --label and --port for any test):
#   --label <l>        launchd label            (com.appydave.appyrig.hub)
#   --port <n>         hub port                 (7191)
#   --bind <hosts>     HUB_BIND_HOSTS           (127.0.0.1,::1,100.126.70.25)
#   --token-file <f>   hub token file, 0600     (~/.config/appyrig/token)
#   --data-dir <d>     DATA_DIR                 (<repo>/data)
#   --log <f>          stdout + stderr          (~/Library/Logs/appyrig-hub.log; <label>.log for other labels)
#   --node <path>      node binary              (the node on PATH now, resolved to an absolute path)
#
# The plist is the whole configuration: it sets HUB_IGNORE_DOTENV=1 so the repo's .env (dev ports)
# cannot override it, and passes the token as a FILE path, never the token itself. launchd does not
# see nvm's PATH, so node is written as an absolute path (review M8).
# Read-only toward OpenRig, tmux and seats: this only manages the hub's own agent.
set -euo pipefail

REAL_LABEL=com.appydave.appyrig.hub
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"

cmd="${1:-}"
[[ -n "$cmd" ]] && shift || true

label=$REAL_LABEL
port=7191
bind=127.0.0.1,::1,100.126.70.25
token_file="$HOME/.config/appyrig/token"
data_dir="$repo/data"
log=""
node_bin="$(command -v node || true)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --label) label="$2"; shift 2 ;;
    --port) port="$2"; shift 2 ;;
    --bind) bind="$2"; shift 2 ;;
    --token-file) token_file="$2"; shift 2 ;;
    --data-dir) data_dir="$2"; shift 2 ;;
    --log) log="$2"; shift 2 ;;
    --node) node_bin="$2"; shift 2 ;;
    *) echo "hub-service: unknown option $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$log" ]]; then
  if [[ "$label" == "$REAL_LABEL" ]]; then log="$HOME/Library/Logs/appyrig-hub.log"
  else log="$HOME/Library/Logs/$label.log"; fi
fi
plist="$HOME/Library/LaunchAgents/$label.plist"
domain="gui/$(id -u)"
entry="$repo/server/dist/index.js"

die() { echo "hub-service: $*" >&2; exit 1; }

[[ "$label" =~ ^[A-Za-z0-9.-]+$ ]] || die "label must be letters, digits, dots, dashes: $label"
[[ "$port" =~ ^[0-9]+$ ]] || die "port must be a number: $port"

xml() { # escape for a plist <string>
  local s="${1//&/&amp;}"; s="${s//</&lt;}"; s="${s//>/&gt;}"; printf '%s' "$s"
}

render_plist() {
  [[ -n "$node_bin" ]] || die "no node on PATH; pass --node /absolute/path/to/node"
  local node_abs node_dir
  node_abs="$(cd "$(dirname "$node_bin")" && pwd -P)/$(basename "$node_bin")"
  node_dir="$(dirname "$node_abs")"
  cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$(xml "$label")</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml "$node_abs")</string>
    <string>$(xml "$entry")</string>
  </array>
  <key>WorkingDirectory</key><string>$(xml "$repo/server")</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key><string>production</string>
    <key>HUB_IGNORE_DOTENV</key><string>1</string>
    <key>PORT</key><string>$(xml "$port")</string>
    <key>CLIENT_URL</key><string>http://localhost:$(xml "$port")</string>
    <key>HUB_BIND_HOSTS</key><string>$(xml "$bind")</string>
    <key>HUB_TOKEN_FILE</key><string>$(xml "$token_file")</string>
    <key>DATA_DIR</key><string>$(xml "$data_dir")</string>
    <key>PATH</key><string>$(xml "$node_dir"):/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>$(xml "$log")</string>
  <key>StandardErrorPath</key><string>$(xml "$log")</string>
</dict>
</plist>
EOF
}

loaded() { launchctl print "$domain/$label" >/dev/null 2>&1; }

case "$cmd" in
  plist)
    render_plist
    ;;
  install)
    [[ -f "$entry" ]] || die "$entry not built; run: npm run build (from $repo)"
    [[ -f "$repo/client/dist/index.html" ]] || die "client/dist not built; run: npm run build (from $repo)"
    [[ -r "$token_file" ]] || die "token file $token_file missing; create it 0600 (e.g. openssl rand -hex 24 > it)"
    mode="$(stat -f '%Lp' "$token_file")"
    [[ "$mode" == "600" || "$mode" == "400" ]] || die "token file $token_file is mode $mode; chmod 600 it"
    [[ "$(tr -d '[:space:]' < "$token_file" | wc -c | tr -d ' ')" -ge 16 ]] || die "token in $token_file is shorter than 16 chars"
    loaded && die "$label is already loaded; uninstall first"
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then die "port $port is in use"; fi
    mkdir -p "$(dirname "$plist")" "$(dirname "$log")" "$data_dir"
    render_plist > "$plist"
    plutil -lint "$plist" >/dev/null || die "generated plist does not lint: $plist"
    launchctl bootstrap "$domain" "$plist"
    echo "hub-service: loaded $label on port $port (log $log)"
    ;;
  uninstall)
    if loaded; then launchctl bootout "$domain/$label"; echo "hub-service: unloaded $label"; fi
    if [[ -f "$plist" ]]; then rm "$plist"; echo "hub-service: removed $plist"; fi
    # bootout returns before launchd has finished; give it up to 10 s before calling it a failure.
    for _ in $(seq 1 20); do loaded || break; sleep 0.5; done
    loaded && die "$label is still loaded after 10 s"
    echo "hub-service: $label not installed (log kept: $log)"
    ;;
  status)
    if loaded; then
      launchctl print "$domain/$label" | grep -E '^\s*(state|pid|last exit code|runs) ='
    else
      echo "hub-service: $label not loaded"
    fi
    ;;
  *)
    sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
