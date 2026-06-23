#!/usr/bin/env bash
# run_router.sh - Starts the llama.cpp server in Router Mode to allow switching models in the GUI
set -euo pipefail

SCRATCH_DIR="/home/chanwoo/.gemini/antigravity/scratch"
LLAMA_SERVER_BIN="$SCRATCH_DIR/llama.cpp/build/bin/llama-server"
MODEL_DIR="$SCRATCH_DIR/models"

if [ ! -f "$LLAMA_SERVER_BIN" ]; then
    echo "Error: llama-server binary not found at $LLAMA_SERVER_BIN."
    exit 1
fi

echo "================================================================="
echo "   Starting llama-server in ROUTER MODE on Jetson Orin Nano Super"
echo "   Models directory: $MODEL_DIR"
echo "   Web UI:           http://localhost:8080"
echo "================================================================="
echo "   Select your model (E4B Q4_K_M or E2B Q8_0) from the dropdown"
echo "   in the Web UI chat interface."
echo "================================================================="
echo "Use Ctrl+C to stop the server."
echo ""

# Start llama-server pointing to the models directory
# Set thread count to 6
# --models-dir scans this directory for GGUF files
exec "$LLAMA_SERVER_BIN" \
  --host 0.0.0.0 \
  --port 8080 \
  --models-dir "$MODEL_DIR" \
  --n-gpu-layers 99 \
  --threads 6 \
  --batch-size 128 \
  --ubatch-size 64
