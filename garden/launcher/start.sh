#!/usr/bin/env bash
# Starts Bloom Garden if it is not running, then opens its dashboard.
# This is what the desktop icon runs.
#   start.sh               start (if needed) and open the dashboard in the browser
#   start.sh --background  start without opening a browser
#   start.sh --stop        stop Garden and the model servers it started
set -euo pipefail

GARDEN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${BLOOM_DATA_DIR:-$HOME/.local/share/bloom}/logs"
mkdir -p "$LOG_DIR"
cd "$GARDEN_DIR"
export PYTHONUNBUFFERED=1 PATH="/usr/local/cuda/bin:$PATH"
export LD_LIBRARY_PATH="/usr/local/cuda/lib64:${LD_LIBRARY_PATH:-}"

case "${1:-}" in
    --stop) exec python3 -m bloom_garden --stop ;;
    --background) OPEN=() ;;
    *) OPEN=(--open) ;;
esac

# If Garden is already running this only opens the dashboard and returns.
nohup setsid python3 -m bloom_garden "${OPEN[@]}" >> "$LOG_DIR/garden.log" 2>&1 < /dev/null &
