#!/bin/bash
# Install the AppyRig collector as a launchd agent on THIS machine (read-only collector).
#
#   collector/scripts/install.sh --hub http://100.126.70.25:7191 --token-file ~/.config/appyrig/token \
#       [--machine-id m2] [--machine-label M2] [--label com.appydave.appyrig.collector] \
#       [--plist-dir ~/Library/LaunchAgents] [--no-load]
#
# Resolves absolute node / tmux / herdr / rig paths now and writes them (and a PATH) into the plist,
# because launchd starts with a thin environment. RunAtLoad + KeepAlive; log at
# ~/Library/Logs/appyrig-collector.log (or appyrig-collector-<suffix>.log for a non-default label).
# The label is overridable so a test install never collides with the real one.
set -euo pipefail

HUB="" TOKEN_FILE="" MACHINE_ID="" MACHINE_LABEL="" LABEL="com.appydave.appyrig.collector"
PLIST_DIR="$HOME/Library/LaunchAgents" LOAD=1
while [ $# -gt 0 ]; do
  case "$1" in
    --hub) HUB="$2"; shift 2 ;;
    --token-file) TOKEN_FILE="$2"; shift 2 ;;
    --machine-id) MACHINE_ID="$2"; shift 2 ;;
    --machine-label) MACHINE_LABEL="$2"; shift 2 ;;
    --label) LABEL="$2"; shift 2 ;;
    --plist-dir) PLIST_DIR="$2"; shift 2 ;;
    --no-load) LOAD=0; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

[ -n "$HUB" ] || { echo "--hub <url> is required" >&2; exit 2; }
[ -n "$TOKEN_FILE" ] || { echo "--token-file <path> is required" >&2; exit 2; }
TOKEN_FILE="${TOKEN_FILE/#\~/$HOME}"
[ -s "$TOKEN_FILE" ] || { echo "token file missing or empty: $TOKEN_FILE" >&2; exit 2; }
if [ -n "$(find "$TOKEN_FILE" -perm -044 2>/dev/null)" ]; then
  echo "warning: $TOKEN_FILE is readable by others; run: chmod 600 $TOKEN_FILE" >&2
fi

if [ -z "$MACHINE_ID" ]; then
  host="$(scutil --get LocalHostName 2>/dev/null | tr 'A-Z' 'a-z' || true)"
  case "$host" in
    *m2*) MACHINE_ID=m2 ;;
    *m4*) MACHINE_ID=m4 ;;
    *roamy*|*macbook*) MACHINE_ID=roamy ;;
    *) echo "cannot guess a machine id from '$host'; pass --machine-id m2|roamy|m4" >&2; exit 2 ;;
  esac
fi
[ -n "$MACHINE_LABEL" ] || MACHINE_LABEL="$(echo "$MACHINE_ID" | tr 'a-z' 'A-Z')"

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
if [ ! -f "$ROOT/dist/main.js" ]; then
  echo "building collector (dist/main.js missing)..." >&2
  (cd "$ROOT/.." && npm run build -w shared && npm run build -w collector) >&2
fi

abs() { command -v "$1" 2>/dev/null || true; }
NODE_BIN="$(abs node)"; [ -n "$NODE_BIN" ] || { echo "node not found on PATH" >&2; exit 2; }
TMUX_BIN="$(abs tmux)"; [ -n "$TMUX_BIN" ] || { echo "tmux not found on PATH" >&2; exit 2; }
HERDR_BIN="$(abs herdr)"   # optional: absent means the viewer source reports not ok
# optional: a machine without OpenRig (the M4) still has tmux seats; the daemon source then reports not ok
RIG_BIN="$(abs rig)"

PATH_VALUE=""
for b in "$NODE_BIN" "$TMUX_BIN" "$RIG_BIN" "$HERDR_BIN"; do
  [ -n "$b" ] && PATH_VALUE="$PATH_VALUE$(dirname "$b"):"
done
PATH_VALUE="$(echo "$PATH_VALUE" | tr ':' '\n' | awk 'NF && !seen[$0]++' | tr '\n' ':')/usr/bin:/bin:/usr/sbin:/sbin"

SUFFIX=""
[ "$LABEL" = "com.appydave.appyrig.collector" ] || SUFFIX="-${LABEL##*.}"
LOG="$HOME/Library/Logs/appyrig-collector$SUFFIX.log"
mkdir -p "$PLIST_DIR" "$HOME/Library/Logs"
PLIST="$PLIST_DIR/$LABEL.plist"

esc() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }
{
  cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$(esc "$LABEL")</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(esc "$NODE_BIN")</string>
    <string>$(esc "$ROOT/dist/main.js")</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(esc "$PATH_VALUE")</string>
    <key>LANG</key><string>en_US.UTF-8</string>
    <key>LC_ALL</key><string>en_US.UTF-8</string>
    <key>APPYRIG_HUB_URL</key><string>$(esc "$HUB")</string>
    <key>APPYRIG_TOKEN_FILE</key><string>$(esc "$TOKEN_FILE")</string>
    <key>APPYRIG_MACHINE_ID</key><string>$(esc "$MACHINE_ID")</string>
    <key>APPYRIG_MACHINE_LABEL</key><string>$(esc "$MACHINE_LABEL")</string>
    <key>APPYRIG_RIG_BIN</key><string>$(esc "${RIG_BIN:-rig}")</string>
    <key>APPYRIG_TMUX_BIN</key><string>$(esc "$TMUX_BIN")</string>
EOF
  [ -n "$HERDR_BIN" ] && echo "    <key>APPYRIG_VIEWER_BIN</key><string>$(esc "$HERDR_BIN")</string>"
  cat <<EOF
  </dict>
  <key>WorkingDirectory</key><string>$(esc "$ROOT")</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$(esc "$LOG")</string>
  <key>StandardErrorPath</key><string>$(esc "$LOG")</string>
</dict>
</plist>
EOF
} > "$PLIST"
# plutil ships with macOS only. The plist is only ever read by launchd, but writing it works anywhere
# (CI is Linux), so lint it where the tool exists rather than failing where it cannot.
if command -v plutil >/dev/null 2>&1; then
  plutil -lint "$PLIST" >/dev/null
fi

echo "wrote $PLIST"
if [ "$LOAD" = 1 ]; then
  DOMAIN="gui/$(id -u)"
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  launchctl bootstrap "$DOMAIN" "$PLIST"
  echo "loaded $LABEL (log: $LOG)"
else
  echo "not loaded (--no-load)"
fi
