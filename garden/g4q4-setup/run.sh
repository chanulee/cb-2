#!/usr/bin/env bash
# run.sh - Starts the llama.cpp server with GPU acceleration on Jetson Orin Nano Super
set -euo pipefail

SCRATCH_DIR="${BLOOM_SCRATCH_DIR:-$HOME/.gemini/antigravity/scratch}"
LLAMA_SERVER_BIN="$SCRATCH_DIR/llama.cpp/build/bin/llama-server"
MODEL_DIR="$SCRATCH_DIR/models"

# NVIDIA's tested Orin Nano Super 8GB baseline.
MODEL_PATH="$MODEL_DIR/gemma-4-E2B-it-Q4_K_M.gguf"

# Quality-first alternative; tighter on the shared 8GB RAM.
# MODEL_PATH="$MODEL_DIR/gemma-4-E4B-it-Q4_K_M.gguf"

# Garden generates short prompts; 2048 leaves RAM for STT and the OS.
CTX_SIZE=2048

if [ ! -f "$LLAMA_SERVER_BIN" ]; then
    echo "Error: llama-server binary not found at $LLAMA_SERVER_BIN."
    echo "Please run the installer script first: ./install.sh"
    exit 1
fi

if [ ! -f "$MODEL_PATH" ]; then
    echo "Error: Model file not found at $MODEL_PATH."
    echo "Download it with:"
    echo "  hf download unsloth/gemma-4-E2B-it-GGUF gemma-4-E2B-it-Q4_K_M.gguf --local-dir $MODEL_DIR"
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
  --host 127.0.0.1 \
  --port 8080 \
  --n-gpu-layers 99 \
  --flash-attn on \
  --parallel 1 \
  --ctx-size "$CTX_SIZE" \
  --threads 6 \
  --batch-size 128 \
  --ubatch-size 64 \
  --cache-ram 0 \
  --temp 1.0 \
  --top-p 0.95 \
  --top-k 64
