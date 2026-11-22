# BLOOM

BLOOM is a local-first reflective ritual built from two devices:

- **Pond** — a handheld Waveshare ESP32-S3 Touch AMOLED 1.75 device. It presents
  prompts one word at a time, records the user's reflection, and turns a
  deliberate on-device action into “I am done.”
- **Garden** — an NVIDIA Jetson Orin Nano Super Developer Kit. It performs
  local speech recognition, manages the ritual, and runs the local language
  model that creates the next first-person reflection prompt.

## Repository generations

| Path | Status | Purpose |
| --- | --- | --- |
| [`pony/`](pony/) | Dev beta, preserved | The former `pond/` prototype: LILYGO T7-S3 + Mac voice assistant. Its product name is Pony. |
| [`garden/`](garden/) | Experimental | Existing Jetson/Gemma setup work. |
| [`v1/`](v1/) | Proof, preserved | Springboard, Wordstream, Particles, Wi-Fi, recorded turn, Garden response. |
| [`v2/`](v2/) | Active | Base software: one-line install, double-click Garden, streamed answers, speed-reading display, over-the-air Pond updates. |

Start with [`v2/README.md`](v2/README.md). To install on a Jetson:

```bash
curl -fsSL https://raw.githubusercontent.com/chanulee/cb-2/main/install.sh | bash
```
