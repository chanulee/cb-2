# Garden runtime

Garden receives Pond WAV audio, runs local STT and Gemma, then returns one
short first-person reflection question.

## This Garden right now

These models are installed on the Orin Nano Super:

| model | quantization | file size |
|---|---:|---:|
| Gemma 4 E2B | Q4_K_M | 3.1 GB |
| Gemma 4 E2B | Q8_0 | 4.8 GB |
| Gemma 4 E4B | Q4_K_M | 4.7 GB |

They are under `$BLOOM_SCRATCH_DIR/models` (the existing device defaults to
`$HOME/.gemini/antigravity/scratch`). E2B Q4_K_M is the default because NVIDIA
demonstrates that exact model on Orin Nano Super 8GB, while leaving about 1.9 GB
more model-weight headroom than E2B Q8_0. E4B Q4_K_M remains the quality-first
comparison model.

`llama.cpp` is installed and the dashboard manages `llama-server`. No
`whisper.cpp` installation was found yet.

## Model dashboard

Run Garden and open <http://127.0.0.1:8765/dashboard>. It discovers installed
GGUF files, runs exactly one managed llama-server, and shows live Jetson RAM,
swap, CPU/GPU, temperature, power, logs, and llama.cpp token speed.

## Garden display

<http://127.0.0.1:8765/garden> is the idle visual for Garden's round 5–7"
screen: a plant seen through a round window, grown from Pond conversations.

- Every finished Pond turn is appended to `~/.bloom/garden.jsonl`
  (`BLOOM_GARDEN_DIR` overrides); `/api/garden` groups it by day with topics.
- Past days are side branches up the stem, oldest lowest. Older days abstract
  like a summarised context: cooler, paler, fewer forks, and past two weeks
  they dissolve into DLA dust (fogleman/dlaf).
- Today grows a three-level crown (topic → facets → twigs with buds) and one
  nonflowers-style flower at the top.
- Drag up/down (or wheel / arrow keys) to walk back through days; tap a branch
  to focus that day; it returns to today after 25 s. With no history yet, or
  with `?demo`, it shows a sample garden.

## Run the UI without inference

```bash
cd v1/garden
python3 -m bloom_garden --host 0.0.0.0 --port 8765
```

The browser transcript box bypasses STT for UI work.

## Connect local inference

Start the E2B Q4_K_M model, then configure Garden:

```bash
DATA_DIR="${BLOOM_SCRATCH_DIR:-$HOME/.gemini/antigravity/scratch}"
"$DATA_DIR/llama.cpp/build/bin/llama-server" \
  -m "$DATA_DIR/models/gemma-4-E2B-it-Q4_K_M.gguf" \
  --host 127.0.0.1 --port 8080 --ctx-size 2048 \
  --flash-attn on --parallel 1

export BLOOM_LLAMA_URL=http://127.0.0.1:8080
export BLOOM_WHISPER_BIN=/path/to/whisper-cli
export BLOOM_WHISPER_MODEL=/path/to/ggml-base.en.bin
python3 -m bloom_garden --host 0.0.0.0 --port 8765
```

Pond and Garden may use the router's 2.4 GHz and 5 GHz bands respectively;
they only need to be on the same non-guest LAN. Until Garden discovery is
implemented, enter Garden's LAN IP in Pond Settings.

Tests: `python3 -m unittest discover -s tests -v`
