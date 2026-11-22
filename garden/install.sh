#!/usr/bin/env bash
# Sets up Bloom Garden on an NVIDIA Jetson Orin Nano Super (Ubuntu) and flashes the Pond.
# Safe to run again: every step skips what is already there.
#
#   ./install.sh [--skip-flash] [--skip-models] [--autostart]
#
#   --skip-flash    do not offer to flash the Pond over USB-C
#   --skip-models   do not build llama.cpp / whisper.cpp or download models
#   --autostart     also start Garden every time you log in
set -euo pipefail

GARDEN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA="${BLOOM_DATA_DIR:-$HOME/.local/share/bloom}"
LEGACY="${BLOOM_SCRATCH_DIR:-$HOME/.gemini/antigravity/scratch}"    # the earlier g4q4 setup
REPO="${BLOOM_GITHUB_REPO:-chanulee/cb-2}"
LLM_MODEL="gemma-4-E2B-it-Q4_K_M.gguf"
LLM_MODEL_URL="https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/$LLM_MODEL"
STT_MODEL="${BLOOM_STT_MODEL:-base.en}"

SKIP_FLASH=0; SKIP_MODELS=0; AUTOSTART=0
for argument in "$@"; do
    case "$argument" in
        --skip-flash) SKIP_FLASH=1 ;;
        --skip-models) SKIP_MODELS=1 ;;
        --autostart) AUTOSTART=1 ;;
        -h|--help) sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "Unknown option: $argument" >&2; exit 2 ;;
    esac
done

if [ "$EUID" -eq 0 ]; then
    echo "Run this as your normal user, not with sudo. It asks for your password when needed." >&2
    exit 1
fi

STEP=0
step() { STEP=$((STEP + 1)); printf '\n\033[1;36m[%d/7] %s\033[0m\n' "$STEP" "$1"; }
note() { printf '      %s\n' "$1"; }
warn() { printf '\033[1;33m      %s\033[0m\n' "$1"; }
first_existing() { for path in "$@"; do [ -e "$path" ] && { echo "$path"; return 0; }; done; return 1; }

mkdir -p "$DATA/models" "$DATA/firmware" "$DATA/logs"

# ---------------------------------------------------------------------------------
step "System packages"
PACKAGES=(build-essential cmake git curl python3-venv avahi-daemon avahi-utils)
MISSING=()
for package in "${PACKAGES[@]}"; do
    dpkg -s "$package" >/dev/null 2>&1 || MISSING+=("$package")
done
if [ "${#MISSING[@]}" -gt 0 ]; then
    note "Installing: ${MISSING[*]}"
    sudo apt-get update
    sudo apt-get install -y "${MISSING[@]}"
else
    note "Already installed."
fi

# ---------------------------------------------------------------------------------
step "CUDA compiler and swap"
export PATH="/usr/local/cuda/bin:$PATH"
if [ "$SKIP_MODELS" -eq 0 ] && ! command -v nvcc >/dev/null; then
    for package in cuda-toolkit-13-2 cuda-toolkit-12-6 cuda-toolkit; do
        if apt-cache show "$package" >/dev/null 2>&1; then
            note "Installing $package"
            sudo apt-get install -y "$package" && break
        fi
    done
fi
if command -v nvcc >/dev/null; then
    GPU_FLAGS=(-DGGML_CUDA=ON -DCMAKE_CUDA_ARCHITECTURES=87)
    note "CUDA found: $(nvcc --version | tail -1)"
else
    GPU_FLAGS=()
    warn "No CUDA compiler found. The models will be built for the CPU and answers will be slow."
    warn "Install the CUDA toolkit for your JetPack version, then run this script again."
fi
SWAP_MB="$(free -m | awk '/^Swap:/ {print $2}')"
if [ "$SKIP_MODELS" -eq 0 ] && [ "${SWAP_MB:-0}" -lt 6000 ] && [ ! -f /swapfile ]; then
    note "Creating an 8 GB swap file so loading the model cannot run out of memory"
    sudo fallocate -l 8G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile >/dev/null
    sudo swapon /swapfile
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
else
    note "Swap: ${SWAP_MB:-0} MB"
fi

# ---------------------------------------------------------------------------------
step "Language model (llama.cpp + Gemma 4 E2B)"
build() {   # build <name> <git url> <cmake target> [extra cmake flags...]
    local name="$1" url="$2" target="$3"; shift 3
    if [ ! -d "$DATA/$name/.git" ]; then
        git clone --depth 1 "$url" "$DATA/$name"
    fi
    cmake -S "$DATA/$name" -B "$DATA/$name/build" -DCMAKE_BUILD_TYPE=Release "${GPU_FLAGS[@]}" "$@"
    cmake --build "$DATA/$name/build" --target "$target" --parallel "$(nproc)"
}
if [ "$SKIP_MODELS" -eq 1 ]; then
    note "Skipped."
else
    if found="$(first_existing "$DATA/llama.cpp/build/bin/llama-server" "$LEGACY/llama.cpp/build/bin/llama-server")"; then
        note "llama-server: $found"
    else
        note "Building llama.cpp. This takes 15 to 30 minutes on the Jetson."
        build llama.cpp https://github.com/ggml-org/llama.cpp.git llama-server -DGGML_NATIVE=ON -DLLAMA_CURL=OFF
    fi
    if found="$(first_existing "$DATA/models/$LLM_MODEL" "$LEGACY/models/$LLM_MODEL")"; then
        note "Model: $found"
    else
        note "Downloading $LLM_MODEL (3.1 GB)"
        curl -L --fail --continue-at - -o "$DATA/models/$LLM_MODEL.part" "$LLM_MODEL_URL"
        mv "$DATA/models/$LLM_MODEL.part" "$DATA/models/$LLM_MODEL"
    fi
fi

# ---------------------------------------------------------------------------------
step "Speech to text (whisper.cpp + $STT_MODEL)"
if [ "$SKIP_MODELS" -eq 1 ]; then
    note "Skipped."
else
    if found="$(first_existing "$DATA/whisper.cpp/build/bin/whisper-server" "$LEGACY/whisper.cpp/build/bin/whisper-server")"; then
        note "whisper-server: $found"
    else
        note "Building whisper.cpp. This takes about 10 minutes."
        build whisper.cpp https://github.com/ggml-org/whisper.cpp.git whisper-server
    fi
    if found="$(first_existing "$DATA/models/ggml-$STT_MODEL.bin" "$DATA/whisper.cpp/models/ggml-$STT_MODEL.bin" "$LEGACY/whisper.cpp/models/ggml-$STT_MODEL.bin")"; then
        note "Model: $found"
    else
        note "Downloading ggml-$STT_MODEL.bin"
        curl -L --fail --continue-at - -o "$DATA/models/ggml-$STT_MODEL.bin.part" \
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-$STT_MODEL.bin"
        mv "$DATA/models/ggml-$STT_MODEL.bin.part" "$DATA/models/ggml-$STT_MODEL.bin"
    fi
fi

# ---------------------------------------------------------------------------------
step "Desktop launcher"
chmod +x "$GARDEN_DIR/launcher/start.sh"
DESKTOP_DIR="$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Desktop")"
write_launcher() {   # write_launcher <file> <extra start.sh arguments>
    mkdir -p "$(dirname "$1")"
    sed -e "s|@START@|$GARDEN_DIR/launcher/start.sh|g" -e "s|@ICON@|$GARDEN_DIR/launcher/bloom.svg|g" \
        -e "s|@ARGS@|$2|g" "$GARDEN_DIR/launcher/bloom-garden.desktop.in" > "$1"
    chmod +x "$1"
}
write_launcher "$HOME/.local/share/applications/bloom-garden.desktop" ""
write_launcher "$DESKTOP_DIR/bloom-garden.desktop" ""
# GNOME only runs a desktop icon on double-click after it is marked as trusted.
gio set "$DESKTOP_DIR/bloom-garden.desktop" metadata::trusted true 2>/dev/null || true
note "Icon: $DESKTOP_DIR/bloom-garden.desktop  (double-click to start Garden)"
if [ "$AUTOSTART" -eq 1 ]; then
    write_launcher "$HOME/.config/autostart/bloom-garden.desktop" " --background"
    note "Garden will also start at every login."
fi

# ---------------------------------------------------------------------------------
step "Pond firmware"
if [ ! -x "$DATA/venv/bin/python" ]; then
    python3 -m venv "$DATA/venv"
fi
"$DATA/venv/bin/pip" install --quiet --upgrade pip esptool esp-idf-nvs-partition-gen
# Keep a copy of the newest released image on Garden: this is what Pond updates to over Wi-Fi.
if curl -L --fail --silent --show-error -o "$DATA/firmware/pond.bin.part" \
        "https://github.com/$REPO/releases/latest/download/bloom-pond.bin"; then
    mv "$DATA/firmware/pond.bin.part" "$DATA/firmware/pond.bin"
    note "Latest released firmware saved for over-the-air updates."
else
    rm -f "$DATA/firmware/pond.bin.part"
    warn "No released firmware could be downloaded from github.com/$REPO."
fi
if [ "$SKIP_FLASH" -eq 1 ]; then
    note "Flashing skipped. Later: $GARDEN_DIR/flash_pond.py"
elif [ -r /dev/tty ]; then
    "$DATA/venv/bin/python" "$GARDEN_DIR/flash_pond.py" --ask < /dev/tty \
        || warn "The Pond was not flashed. Try again later with: $DATA/venv/bin/python $GARDEN_DIR/flash_pond.py"
else
    note "No terminal to ask questions on. Flash later with: $DATA/venv/bin/python $GARDEN_DIR/flash_pond.py"
fi

# ---------------------------------------------------------------------------------
step "Start Garden"
"$GARDEN_DIR/launcher/start.sh" --background || warn "Garden did not start; see $DATA/logs/garden.log"
PORT=8765
cat <<DONE

Bloom Garden is installed.
  Dashboard    http://$(hostname).local:$PORT  (or double-click "Bloom Garden" on the desktop)
  Settings     ~/.config/bloom/garden.json
  Logs         $DATA/logs/garden.log
The Pond finds Garden by itself when both are on the same Wi-Fi. Press its button and speak.
DONE
