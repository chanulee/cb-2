#!/usr/bin/env bash
# Hand a firmware build to Garden and have it push the build to every Pond on the Wi-Fi.
#
#   ./publish.sh                         on the Jetson itself
#   ./publish.sh jetson.local TOKEN      from another computer; TOKEN is "upload_token"
#                                        in ~/.config/bloom/garden.json on the Jetson
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE="${BLOOM_IMAGE:-$HERE/firmware/build/bloom-pond.bin}"
HOST="${1:-127.0.0.1}"
TOKEN="${2:-$(python3 -c 'import json, pathlib; print(json.loads(pathlib.Path("~/.config/bloom/garden.json").expanduser().read_text())["upload_token"])' 2>/dev/null || true)}"

[ -f "$IMAGE" ] || { echo "No build at $IMAGE. Run: idf.py build" >&2; exit 1; }
[ -n "$TOKEN" ] || { echo "No upload token. Pass it as the second argument." >&2; exit 1; }
curl --fail-with-body --silent --show-error -H "X-Bloom-Token: $TOKEN" -H "X-Bloom-Push: 1" \
    --data-binary "@$IMAGE" "http://$HOST:8765/api/firmware"
echo
