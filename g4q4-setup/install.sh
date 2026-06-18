#!/usr/bin/env bash
# install.sh - All-in-one setup and installer script for Gemma 4 E4B on Jetson Orin Nano Super
# Run as a regular user. The script will prompt for sudo password when necessary.
set -euo pipefail

# Directories
SCRATCH_DIR="/home/chanwoo/.gemini/antigravity/scratch"
SETUP_DIR="$SCRATCH_DIR/g4q4-setup"
MODEL_DIR="$SCRATCH_DIR/models"

echo "================================================================="
echo "   Jetson Orin Nano Super - Gemma 4 E4B Local LLM Installer"
echo "================================================================="
echo "This script will:"
echo " 1. Configure 8GB Swap Space (crucial for 8GB RAM systems)"
echo " 2. Install CUDA Toolkit 13.2 & development dependencies"
echo " 3. Install Homebrew (Linuxbrew)"
echo " 4. Build llama.cpp from source with Orin-specific GPU acceleration"
echo " 5. Download Gemma 4 E4B Q4_K_M model (~4.7GB)"
echo "================================================================="
read -p "Press Enter to start installation..."

# Ensure we are not running as root directly
if [ "$EUID" -eq 0 ]; then
    echo "Error: Please run this script as a normal user (not with sudo)."
    echo "The script will ask for your password automatically when running system tasks."
    exit 1
fi

echo ""
echo "-----------------------------------------------------------------"
echo "Step 1/5: Configuring 8GB Swap Space"
echo "-----------------------------------------------------------------"
if [ -f /swapfile ]; then
    echo "Swapfile /swapfile already exists. Skipping."
else
    echo "Creating swapfile (8GB)... This prevents out-of-memory crashes."
    sudo fallocate -l 8G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
    echo "Swap space created and enabled successfully!"
fi
swapon --show

echo ""
echo "-----------------------------------------------------------------"
echo "Step 2/5: Installing System Dependencies & CUDA Toolkit"
echo "-----------------------------------------------------------------"
sudo apt-get update
sudo apt-get install -y \
    build-essential \
    cmake \
    git \
    python3-pip \
    python3-venv \
    cuda-toolkit-13-2

# Configure environment variables for the current shell and profile
export PATH=/usr/local/cuda/bin:$PATH
export LD_LIBRARY_PATH=/usr/local/cuda/lib64:${LD_LIBRARY_PATH:-}

if ! grep -q "cuda/bin" "$HOME/.bashrc"; then
    echo 'export PATH=/usr/local/cuda/bin:$PATH' >> "$HOME/.bashrc"
    echo 'export LD_LIBRARY_PATH=/usr/local/cuda/lib64:${LD_LIBRARY_PATH:-}' >> "$HOME/.bashrc"
    echo "CUDA environment variables added to ~/.bashrc"
fi

echo ""
echo "-----------------------------------------------------------------"
echo "Step 3/5: Installing Homebrew"
echo "-----------------------------------------------------------------"
# Auto-load Homebrew if already installed
if [ -f "/home/linuxbrew/.linuxbrew/bin/brew" ]; then
    eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"
fi

if command -v brew &>/dev/null; then
    echo "Homebrew is already installed."
else
    echo "Installing Homebrew..."
    NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    
    echo 'eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv bash)"' >> "$HOME/.bashrc"
    eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv bash)"
    echo "Homebrew installed successfully!"
fi

echo ""
echo "-----------------------------------------------------------------"
echo "Step 4/5: Compiling llama.cpp with GPU Acceleration"
echo "-----------------------------------------------------------------"
cd "$SCRATCH_DIR"
if [ -d llama.cpp ]; then
    echo "llama.cpp repository already exists. Updating..."
    cd llama.cpp
    git pull
else
    echo "Cloning llama.cpp repository..."
    git clone --recursive https://github.com/ggml-org/llama.cpp.git
    cd llama.cpp
fi

echo "Configuring and compiling llama.cpp for Jetson Orin (Ampere/87)..."
cmake -B build \
  -DGGML_CUDA=ON \
  -DGGML_CUDA_F16=ON \
  -DGGML_CUDA_FA_ALL_QUANTS=ON \
  -DLLAMA_CURL=ON \
  -DCMAKE_CUDA_ARCHITECTURES=87

cmake --build build --config Release --parallel 6
echo "llama.cpp compiled successfully with CUDA!"

echo ""
echo "-----------------------------------------------------------------"
echo "Step 5/5: Downloading Gemma 4 E4B Q4_K_M GGUF Model"
echo "-----------------------------------------------------------------"
mkdir -p "$MODEL_DIR"
cd "$SETUP_DIR"

if [ ! -d venv ]; then
    python3 -m venv venv
fi
source venv/bin/activate
pip install -U pip
pip install -U "huggingface_hub[cli]"

echo "Downloading gemma-4-E4B-it-Q4_K_M.gguf from unsloth/gemma-4-E4B-it-GGUF..."
hf download unsloth/gemma-4-E4B-it-GGUF gemma-4-E4B-it-Q4_K_M.gguf --local-dir "$MODEL_DIR"

echo ""
echo "================================================================="
echo "   Installation Completed Successfully!"
echo "================================================================="
echo "You are now ready to run your local LLM!"
echo "To start the llama.cpp server, run:"
echo "  ./run.sh"
echo "================================================================="
