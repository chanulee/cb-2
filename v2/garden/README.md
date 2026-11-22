# Garden

The Jetson side of Bloom 2. It needs only the Python that ships with Ubuntu; the two
model servers (`llama-server`, `whisper-server`) are separate programs that Garden
starts and stops.

## Everyday use

| Do this | To |
| --- | --- |
| Double-click **Bloom Garden** on the desktop | start Garden and open the dashboard |
| Right-click the icon, "Stop Bloom Garden" | stop Garden and free the GPU memory |
| `./launcher/start.sh --background` | start without a browser (used by `--autostart`) |
| `python3 -m bloom_garden --mock` | run with canned answers and no model, to test a Pond |

The dashboard at <http://localhost:8765> shows whether the models are loaded, which
Ponds have checked in, the firmware Garden offers, and the recent turns with their
timings. Its text box runs a turn without a Pond and previews the wordstream.

## Settings

`~/.config/bloom/garden.json` is created on first start. Only the keys you want to
change need to be in it; the defaults are in [`bloom_garden/config.py`](bloom_garden/config.py).

```json
{
  "wpm": 300,
  "language": "en",
  "llm": { "model": "/home/me/models/gemma-4-E4B-it-Q4_K_M.gguf", "ctx_size": 4096 },
  "firmware": { "auto_install": false }
}
```

To change what the model is told, copy [`bloom_garden/system_prompt.txt`](bloom_garden/system_prompt.txt)
to `~/.config/bloom/system_prompt.txt` and edit the copy. Restart Garden after changes.

Garden looks for `llama.cpp/build/bin/llama-server`, `whisper.cpp/build/bin/whisper-server`
and `models/` under `~/.local/share/bloom`, then `$BLOOM_SCRATCH_DIR`, then
`~/.gemini/antigravity/scratch` (the earlier `garden/g4q4-setup` location). If a
server already answers on port 8080 or 8081, Garden uses it and starts nothing.

## Development

```bash
cd v2/garden
python3 -m unittest discover -s tests -v    # no model, GPU or network needed
python3 -m bloom_garden --mock --open
```

- `bloom_garden/pipeline.py` one turn: PCM → whisper.cpp → llama.cpp → events
- `bloom_garden/server.py` HTTP routes ([`../PROTOCOL.md`](../PROTOCOL.md))
- `bloom_garden/services.py` model server processes and the mDNS advert
- `bloom_garden/firmware.py` the Pond image Garden serves
- `bloom_garden/static/index.html` dashboard
