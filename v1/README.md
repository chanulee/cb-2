# BLOOM v1 proof

One complete home-network loop, without an app store or update framework:

```text
Pond Springboard → Pond app → wordstream → explicit record / I'm done
→ 16 kHz mono WAV over HTTP → Garden whisper.cpp → Gemma 4
→ one first-person question → Pond wordstream
```

PondOS boots to a springboard. It also has **Particles**, a touch +
dual-microphone visualizer, and **Settings** for hardware brightness,
0/90/180/270° rotation, nearby Wi-Fi scanning, credentials, and the Garden
IP/hostname. Settings persist and Wi-Fi reconnects automatically. Swipe right
to go back; there is no permanent header or back button.

Bluetooth is intentionally outside this proof. The screen and English keyboard
already cover setup and recovery on a normal 2.4 GHz home network.

## Try the UI

```bash
cd v1/garden
python3 -m bloom_garden
```

Open <http://localhost:8765>. The browser mic simulates Pond; its transcript
box bypasses STT while developing the UI.

The browser is a UI simulator: its brightness filter is only a preview. On the
device, the same control calls the Waveshare display BSP and changes the actual
AMOLED output.

## Physical Pond

Target: standard Waveshare ESP32-S3-Touch-AMOLED-1.75 with ES7210 dual mics.

```bash
cd v1/pond/firmware
idf.py set-target esp32s3
idf.py build flash monitor
```

Use ESP-IDF 5.5.4. The firmware uses the current Waveshare BSP 3.x. The older
`pony/` firmware remains the known-working reference. Arduino IDE can flash an
Arduino port, but this v1 source is an ESP-IDF project; maintaining both now
would duplicate the hardware work.

## Code shape

- `garden/bloom_garden/session.py`: pure immutable ritual transition
- `garden/bloom_garden/inference.py`: whisper.cpp and llama.cpp side effects
- `garden/static/app.js`: pure reducer/particle steps around browser effects
- `pond/firmware/main/`: LVGL, Wi-Fi/NVS, dual-mic capture, WAV HTTP turn

Current Garden status: E2B Q4_K_M is the deployment default; E2B Q8_0 and E4B
Q4_K_M remain installed for comparison. Whisper.cpp is not yet installed. Pond
app/content updating remains separate from this runtime speech loop.
