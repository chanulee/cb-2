# Gemma 4 on Jetson Orin Nano Super

This setup runs Gemma 4 locally with a native CUDA build of `llama.cpp` on the
8 GB Jetson Orin Nano Super. The deployment default is
`gemma-4-E2B-it-Q4_K_M.gguf`.

## Why this model

- NVIDIA demonstrates this exact Unsloth E2B Q4_K_M checkpoint on an Orin Nano
  Super 8 GB with all layers on its SM 8.7 GPU.
- Q4_K_M leaves roughly 1.9 GB more model-weight headroom than E2B Q8_0 for the
  OS, KV cache, and speech recognition.
- E4B Q4_K_M remains available when response quality matters more than RAM and
  latency. E2B Q8_0 is kept only as a comparison baseline.

References: [NVIDIA Gemma 4 VLA demo](https://huggingface.co/blog/nvidia/gemma4),
[Jetson AI Lab Gemma 4 guide](https://www.jetson-ai-lab.com/tutorials/gemma4-on-jetson/),
and [the selected model](https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/blob/main/gemma-4-E2B-it-Q4_K_M.gguf).

## Install

The existing device stores builds and models under
`$HOME/.gemini/antigravity/scratch`. Set `BLOOM_SCRATCH_DIR` to use another
location.

For a fresh Jetson with JetPack 7.2:

```bash
./install.sh
```

The installer creates an 8 GB swap safety net, installs CUDA/build tools,
builds `llama.cpp` for CUDA compute capability 8.7, and downloads the model.
Swap prevents an out-of-memory kill during loading; it does not make inference
faster.

If CUDA and `llama.cpp` are already installed, download only the model:

```bash
hf download unsloth/gemma-4-E2B-it-GGUF \
  gemma-4-E2B-it-Q4_K_M.gguf \
  --local-dir "${BLOOM_SCRATCH_DIR:-$HOME/.gemini/antigravity/scratch}/models"
```

## Run later

```bash
./run.sh
```

The runner uses the settings validated for this board: all layers on CUDA,
Flash Attention, one parallel slot, six CPU threads, and a 2048-token context.
The server listens on port 8080. Garden connects through its OpenAI-compatible
`/v1` API.

This command verifies relative performance without starting the server:

```bash
DATA_DIR="${BLOOM_SCRATCH_DIR:-$HOME/.gemini/antigravity/scratch}"
"$DATA_DIR/llama.cpp/build/bin/llama-bench" \
  -m "$DATA_DIR/models/gemma-4-E2B-it-Q4_K_M.gguf" \
  -ngl 99 -fa on -p 512 -n 128 -r 3 -t 6
```

Run `tegrastats` alongside it. Compare prompt processing (`pp512`), generation
(`tg128`), RAM, swap, and power under the same Jetson power mode.

## Operating notes

- Keep context at 2048 for Garden's short prompts; larger contexts consume more
  unified memory.
- Run headless or stop unnecessary desktop/container services if RAM is tight.
- The current Garden pipeline uses Whisper before Gemma, so it does not depend
  on Gemma's native-audio path.
- For native vision, add the matching `mmproj` file; it has a separate memory
  cost.
- Experimental QAT/MTP builds can decode faster, but current llama.cpp
  regressions make them a benchmark option rather than the deployment default.

If loading fails, confirm `swapon --show`, then check the server log contains a
CUDA device and `ARCHS = 870`. Reducing context or selecting E2B Q4_K_S is
preferable to moving layers back to the slower CPU.

## Measure Gemma + SenseVoice RAM

Install the CPU runtime and unpack the INT8 model once, then run the stack test:

```bash
python3 -m venv "$HOME/.gemini/antigravity/scratch/sherpa-venv"
"$HOME/.gemini/antigravity/scratch/sherpa-venv/bin/pip" install sherpa-onnx numpy

cd "$HOME/.gemini/antigravity/scratch/models"
wget https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2
tar xf sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2

cd /path/to/cb-2/garden/g4q4-setup
"$HOME/.gemini/antigravity/scratch/sherpa-venv/bin/python" benchmark_stack.py
```

The test stops only user-owned `llama-server` processes, starts one E2B
Q4_K_M server, keeps CPU SenseVoice loaded beside it, runs cold/warm STT and
one Gemma request, then writes RAM/swap/RSS peaks to
`/tmp/bloom-stack-benchmark.json`. Pass `--wav /path/to/pond.wav` to test real
Pond audio, and add `--language ko` for a Korean sample. Both the benchmark and
`run.sh` disable llama.cpp's prompt cache so it cannot grow toward its 8 GB
default limit during long-running deployment.
