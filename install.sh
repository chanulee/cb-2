#!/usr/bin/env bash
# Bloom 2 one-line setup. Run this on the Jetson, in a terminal:
#
#   curl -fsSL https://raw.githubusercontent.com/chanulee/cb-2/main/install.sh | bash
#
# It downloads this repository to ~/cb-2 (or updates it) and runs v2/garden/install.sh,
# which installs Garden on the Jetson and flashes the Pond over USB-C.
set -euo pipefail

REPO_URL="${BLOOM_REPO_URL:-https://github.com/chanulee/cb-2.git}"
BRANCH="${BLOOM_BRANCH:-main}"
TARGET="${BLOOM_HOME:-$HOME/cb-2}"

here="$(cd "$(dirname "${BASH_SOURCE[0]:-.}")" 2>/dev/null && pwd || true)"
if [ -n "$here" ] && [ -x "$here/v2/garden/install.sh" ]; then
    exec "$here/v2/garden/install.sh" "$@"      # already inside a checkout
fi

if ! command -v git >/dev/null; then
    sudo apt-get update && sudo apt-get install -y git
fi
if [ -d "$TARGET/.git" ]; then
    echo "Updating $TARGET"
    git -C "$TARGET" pull --ff-only || echo "Could not update $TARGET; continuing with the copy that is there."
else
    echo "Downloading Bloom to $TARGET"
    git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$TARGET"
fi
exec "$TARGET/v2/garden/install.sh" "$@"
