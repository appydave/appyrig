#!/bin/bash
# Remove the AppyRig collector launchd agent from THIS machine. Leaves the token file and log alone.
#   collector/scripts/uninstall.sh [--label com.appydave.appyrig.collector] [--plist-dir ~/Library/LaunchAgents]
set -euo pipefail
LABEL="com.appydave.appyrig.collector" PLIST_DIR="$HOME/Library/LaunchAgents"
while [ $# -gt 0 ]; do
  case "$1" in
    --label) LABEL="$2"; shift 2 ;;
    --plist-dir) PLIST_DIR="$2"; shift 2 ;;
    -h|--help) sed -n '2,3p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
PLIST="$PLIST_DIR/$LABEL.plist"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null && echo "unloaded $LABEL" || echo "$LABEL was not loaded"
if [ -f "$PLIST" ]; then rm "$PLIST"; echo "removed $PLIST"; else echo "no plist at $PLIST"; fi
