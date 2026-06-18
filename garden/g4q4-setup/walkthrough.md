# Setup Walkthrough: Gemma 4 E4B on Jetson Orin Nano Super

We have successfully configured and verified local LLM execution of the **Gemma 4 E4B GGUF** model using a custom, GPU-accelerated build of `llama.cpp` on your Jetson Orin Nano Super Developer Kit (8GB unified memory, Ubuntu 24.04).

---

## 1. What We Accomplished

### A. Swap Memory Setup
*   Created an **8GB Swap File** on your active partition to act as a memory safeguard. 
*   **Why it was critical**: When the model loaded, the physical RAM usage peaked at 6.6Gi (out of 7.3Gi available). The OS successfully moved 1.2Gi of inactive background memory to Swap. Without this swap space, the kernel's Out Of Memory (OOM) killer would have immediately crashed the `llama-server`.

### B. CUDA 13.2 & Compilers Installed
*   Installed the official `cuda-toolkit-13-2`, `build-essential`, and `cmake` from your Jetson's APT repositories.

### C. Homebrew Installation
*   Installed Homebrew (Linuxbrew) at `/home/linuxbrew/.linuxbrew/bin/brew` as requested. 
*   Added Homebrew configuration code to your `~/.bashrc` profile.

### D. Jetson-Optimized `llama.cpp` Compilation
*   Cloned `llama.cpp` and compiled it from source with Orin-specific compiler optimizations (NVIDIA Ampere architecture, compute capability 87):
    *   `-DGGML_CUDA=ON` (enables CUDA core acceleration)
    *   `-DGGML_CUDA_F16=ON` (accelerates FP16 processing)
    *   `-DGGML_CUDA_FA_ALL_QUANTS=ON` (enables FlashAttention for quantized models)
    *   `-DCMAKE_CUDA_ARCHITECTURES=87` (compiles specifically for the Jetson Orin GPU)

### E. Model Download
*   Installed the Hugging Face `hf` tool inside a python virtual environment to bypass PEP 668 restrictions.
*   Downloaded the **`gemma-4-E4B-it-Q4_K_M.gguf`** model (~4.7GB) from the `unsloth/gemma-4-E4B-it-GGUF` repository. We resolved a casing conflict (Hugging Face requires uppercase `E4B` in file naming).

### F. Automation Scripts
We created a dedicated setup folder `/home/chanwoo/.gemini/antigravity/scratch/jetson-llm-setup/` containing:
1.  [system_setup.sh](file:///home/chanwoo/.gemini/antigravity/scratch/jetson-llm-setup/system_setup.sh): Configures swap and installs apt packages (requires `sudo`). Already executed.
2.  [user_setup.sh](file:///home/chanwoo/.gemini/antigravity/scratch/jetson-llm-setup/user_setup.sh): Configures paths, compiles `llama.cpp`, and downloads the model (requires normal user). Already executed.
3.  [run_server.sh](file:///home/chanwoo/.gemini/antigravity/scratch/jetson-llm-setup/run_server.sh): Starts the server with conservative 4096 context, text-only, offloading all layers to GPU.

---

## 2. Verification Results

We verified the server by starting it and querying the health and OpenAI-compatible chat endpoints:

1.  **Health Check Response**:
    ```json
    {"status":"ok"}
    ```
2.  **Test Query (Inference Output)**:
    We queried the endpoint `/v1/chat/completions` with the prompt *"Hello! What is your name?"* and got a successful response with reasoning tokens starting:
    ```
    "content": "Thinking Process:\n\n1. Analyze the Request: The user is asking, \"Hello! What is your name?\"\n2. Recall Core Identity:\n * Name: Gemma 4.\n *"
    ```
3.  **Performance Timings**:
    *   **Prompt Evaluation**: 23 tokens processed at ~3.3 tokens/second (initial cache paging).
    *   **Text Generation**: 50 tokens generated at **~3.9 tokens/second** using Orin GPU acceleration.

---

## 3. How to Use and Maintain

### Running the Server
To start the model, simply navigate to the setup folder and execute the run script:
```bash
cd /home/chanwoo/.gemini/antigravity/scratch/jetson-llm-setup
./run_server.sh
```
The server will start listening at `http://localhost:8080`. You can access it:
*   Via your browser (it has a built-in chat UI).
*   Via API calls (port 8080 acts as an OpenAI-compatible API server).

### Advanced Testing: Upgrading to `UD-Q4_K_XL`
Now that you have confirmed the Q4_K_M baseline is stable and works with your memory footprint, you can test the higher-quality Unsloth Dynamic model:
1.  Activate the virtual environment and download the XL model:
    ```bash
    cd /home/chanwoo/.gemini/antigravity/scratch/jetson-llm-setup
    source venv/bin/activate
    hf download unsloth/gemma-4-E4B-it-GGUF gemma-4-E4B-it-UD-Q4_K_XL.gguf --local-dir /home/chanwoo/.gemini/antigravity/scratch/models
    ```
2.  Open [run_server.sh](file:///home/chanwoo/.gemini/antigravity/scratch/jetson-llm-setup/run_server.sh).
3.  Comment out the Q4_K_M path (line 10) and uncomment the UD-Q4_K_XL path (line 14).
4.  Run `./run_server.sh` and observe performance.

### Maintenance
*   **Update `llama.cpp`**: Run `git pull` in `/home/chanwoo/.gemini/antigravity/scratch/llama.cpp` and re-run the `cmake` commands in [user_setup.sh](file:///home/chanwoo/.gemini/antigravity/scratch/jetson-llm-setup/user_setup.sh#L53-L60) to rebuild.
*   **Monitor Resources**: Open a second terminal and run `tegrastats` to monitor Orin memory, swap usage, temperature, and GPU load in real-time.
