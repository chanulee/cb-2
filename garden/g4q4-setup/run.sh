#!/usr/bin/env bash
# run.sh - Starts the llama.cpp server with GPU acceleration on Jetson Orin Nano Super
set -euo pipefail

SCRATCH_DIR="/home/chanwoo/.gemini/antigravity/scratch"
LLAMA_SERVER_BIN="$SCRATCH_DIR/llama.cpp/build/bin/llama-server"
MODEL_DIR="$SCRATCH_DIR/models"

# Default Model (Q4_K_M) - SAFE & RECOMMENDED
MODEL_PATH="$MODEL_DIR/gemma-4-E4B-it-Q4_K_M.gguf"

# Advanced Model (UD-Q4_K_XL) - TEST AFTER STABILITY CONFIRMED
# Uncomment the line below to switch to the XL model:
# MODEL_PATH="$MODEL_DIR/gemma-4-E4B-it-UD-Q4_K_XL.gguf"

# Context Size (Start with 4096. Try 8192 if you have sufficient memory headroom)
CTX_SIZE=4096

if [ ! -f "$LLAMA_SERVER_BIN" ]; then
    echo "Error: llama-server binary not found at $LLAMA_SERVER_BIN."
    echo "Please run the installer script first: ./install.sh"
    exit 1
fi

if [ ! -f "$MODEL_PATH" ]; then
    echo "Error: Model file not found at $MODEL_PATH."
    echo "Make sure the model is downloaded. If you switched to UD-Q4_K_XL, download it by running:"
    echo "  source venv/bin/activate"
    echo "  hf download unsloth/gemma-4-E4B-it-GGUF gemma-4-E4B-it-UD-Q4_K_XL.gguf --local-dir $MODEL_DIR"
    exit 1
fi

echo "================================================================="
echo "   Starting llama-server on Jetson Orin Nano Super (GPU)"
echo "   Model:   $(basename "$MODEL_PATH")"
echo "   Context:  $CTX_SIZE tokens"
echo "   Web UI:   http://localhost:8080"
echo "================================================================="
echo "Use Ctrl+C to stop the server."
echo ""

# Start server offloading all layers (99) to GPU
exec "$LLAMA_SERVER_BIN" \
  -m "$MODEL_PATH" \
  --host 0.0.0.0 \
  --port 8080 \
  --n-gpu-layers 99 \
  --ctx-size "$CTX_SIZE" \
  --threads 6 \
  --batch-size 128 \
  --ubatch-size 64 \
  --temp 1.0 \
  --top-p 0.95 \
  --top-k 64
