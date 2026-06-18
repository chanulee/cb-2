# Gemma 4 E4B local LLM on Jetson Orin Nano Super

Setup guide + automation script to run Google's **Gemma 4 E4B GGUF** model on your **NVIDIA Jetson Orin Nano Super Developer Kit** (8GB unified memory, 67 TOPS).

I'm using a custom compiled build of `llama.cpp` targeting the Orin's Ampere GPU to get full hardware acceleration.
Using Q4 model instead of Q8 - Ref [this video](https://www.youtube.com/watch?v=EGnA_kqu3is&list=WL&index=5)

## Quick Start: One-Command Installation

To install everything, simply open your terminal, navigate to this folder, and run:

```bash
./install.sh
```

This was tested on JetPack 7.2. If you have to set up your Jetpack, check the official setup guide by [NVIDIA](https://docs.nvidia.com/jetson/orin-nano-devkit/user-guide/latest/quick_start.html#overview)

### What the installer does:
1.  **Configures 8GB Swap Space**: Crucial for Orin's 8GB unified memory to prevent out-of-memory crashes.
2.  **Installs System Dependencies**: Installs compilers, `git`, `cmake`, and the `cuda-toolkit-13-2`.
3.  **Installs Homebrew**: Installs the Linux package manager for other utilities.
4.  **Compiles llama.cpp from Source**: Configures `llama.cpp` to use your GPU cores with optimizations:
    *   CUDA Core Acceleration (`GGML_CUDA=ON`)
    *   FlashAttention (`GGML_CUDA_FA_ALL_QUANTS=ON`)
    *   Ampere Architecture Targeting (`CMAKE_CUDA_ARCHITECTURES=87`)
5.  **Downloads the Model**: Downloads the `gemma-4-E4B-it-Q4_K_M.gguf` (~4.7GB) model from Hugging Face.

## Running the Local LLM Server

Once installation is finished, start your local server by running:

```bash
./run.sh
```

### Accessing your LLM:
*   **Web Chat UI**: Open your web browser and go to **`http://localhost:8080`**. It has a built-in interactive chat interface.
*   **API Server**: The port `8080` acts as an OpenAI-compatible API server. You can connect it to other apps (like Open WebUI, LlamaIndex, or LangChain) using `http://localhost:8080/v1`.

## Customization & Advanced Tuning

The runner script (`run.sh`) is configured with conservative settings to ensure 100% stability on an 8GB memory footprint. You can tune these settings easily by editing the script:

### 1. Test the Higher-Quality XL Model (`UD-Q4_K_XL`)
Unsloth provides a Quantization-Aware Trained (QAT) model that provides higher reasoning quality. Once you confirm the baseline runs stably, you can test it:
1.  Download the XL model:
    ```bash
    source venv/bin/activate
    hf download unsloth/gemma-4-E4B-it-GGUF gemma-4-E4B-it-UD-Q4_K_XL.gguf --local-dir ../models
    ```
2.  Open `run.sh` in a text editor.
3.  Comment out line 10 and uncomment line 14:
    ```bash
    # MODEL_PATH="$MODEL_DIR/gemma-4-E4B-it-Q4_K_M.gguf"
    MODEL_PATH="$MODEL_DIR/gemma-4-E4B-it-UD-Q4_K_XL.gguf"
    ```
4.  Start the server again: `./run.sh`.

### 2. Increase Context Size (4096 vs. 8192)
A larger context window increases memory use due to the KV cache. If your memory headroom allows, you can change `CTX_SIZE=4096` to `CTX_SIZE=8192` in `run.sh`.

## Monitoring Resources
Since Jetson uses unified memory, you should monitor your hardware load. Open a separate terminal and run:
```bash
tegrastats
```
This shows real-time GPU load, CPU core usage, swap usage, and physical memory footprint.

Also, we can optimise RAM by turning off the GUI mode of Jetpack according to https://www.jetson-ai-lab.com/tutorials/ram-optimization/ :
```bash
sudo init 3     # stop the desktop
# log your user back into the console (Ctrl+Alt+F1, F2, etc.)
sudo init 5     # restart the desktop
```

## Troubleshooting

*   **Server starts but crashes when prompt is sent**: This is an Out of Memory (OOM) crash. Ensure your Swap space is active by running `swapon --show`. If it is active and still crashes, decrease your context size (`CTX_SIZE`) in `run.sh` to `2048` or `3072`.
*   **Response generation is extremely slow**: Make sure `llama.cpp` compiled with CUDA support. When launching `./run.sh`, look for the print line:
    `system_info: ... CUDA : ARCHS = 870 ...`
    If it says `CUDA` is not enabled, the model is running on the CPU. Re-run `./install.sh` to rebuild.
