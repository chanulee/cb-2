**English** | [한국어](README.ko.md)

# Bloom 2

Bloom 2 is the working follow-up to [Cognitive Bloom](https://mapprojectoffice.com/work/cognitive-bloom/),
a device for a short ritual of self-reflection. You press a button on a small round
handheld and say what is on your mind. A computer in your home turns that into a
first-person thought with one question, and the handheld shows it one word at a time.
Nothing leaves your home network.

| | Pond | Garden |
| --- | --- | --- |
| Hardware | Waveshare ESP32-S3 Touch AMOLED 1.75 | NVIDIA Jetson Orin Nano Super Developer Kit |
| Job | Button, microphones, wordstream display | Speech to text, language model, firmware updates |
| Code | [`pond/`](pond/) (ESP-IDF, C++) | [`garden/`](garden/) (Python standard library) |

## Install

You need both devices, a USB-C data cable, and a Wi-Fi network with a 2.4 GHz band.
The Jetson runs its normal Ubuntu desktop (JetPack) and is online.

**1. On the Jetson, open a terminal and paste one line:**

```bash
curl -fsSL https://raw.githubusercontent.com/chanulee/cb-2/main/install.sh | bash
```

It asks for your password once, then works through seven steps: system packages, CUDA
and swap, llama.cpp with the Gemma 4 E2B model (3.1 GB), whisper.cpp with its
`base.en` model, the desktop icon, the Pond firmware, and starting Garden. A first run
takes 30 to 60 minutes, almost all of it compiling and downloading. Steps that are
already done are skipped, so it is safe to run again.

**2. When it says "Connect the Pond", plug the Pond into the Jetson and press Enter.**

It offers the Wi-Fi the Jetson is on, writes the firmware and the Wi-Fi password to
the Pond, and restarts it. This cable step happens once. Later firmware arrives over
Wi-Fi.

**3. Unplug the Pond and use it.** Press **Speak** (or the BOOT button on the side),
talk, press **Done**. The answer streams onto the screen.

After a reboot of the Jetson, double-click **Bloom Garden** on the desktop. It starts
the models and opens the dashboard; closing the browser does not stop it. Right-click
the icon and choose "Stop Bloom Garden", or press "Quit Garden" in the dashboard, to
free the memory. `./garden/install.sh --autostart` makes it start at every login.

## How a turn works

```text
Pond                                   Garden (Jetson)
────                                   ───────────────
press Speak, talk, press Done
16 kHz mono PCM  ── POST /api/turn ──▶ whisper.cpp  (speech to text, GPU)
                                       llama.cpp    (Gemma 4 E2B, streamed, GPU)
wordstream  ◀── one JSON line per ──── {"type":"delta","text":" What"} ...
                piece of the answer
```

- **Finding each other.** Garden advertises `_bloom._tcp` with mDNS (avahi). The Pond
  queries for it, so no IP address is typed. An address can be typed in Pond Settings
  if a router blocks mDNS.
- **Protocol.** Plain HTTP on port 8765: one request per turn, answered with
  newline-delimited JSON as the model produces text. Details: [`PROTOCOL.md`](PROTOCOL.md).
  You can drive it with `curl`.
- **Wordstream.** Rapid serial visual presentation: one word at a time at 270 words
  per minute. One letter of each word, slightly left of its middle, is highlighted and
  always drawn at the exact centre of the screen, so the eyes stay still. Words that
  end a sentence stay 2.2 times longer, a comma 1.5 times, long words 1.3 times.
- **Updates.** Garden holds one Pond firmware image. Pressing **Update Ponds now** in
  the dashboard sends each Pond a signal; a Pond that runs a different build then
  downloads Garden's image into its spare flash slot and restarts into it. If the new
  build crashes before it has joined Wi-Fi, the bootloader returns to the previous one.

## Defaults and where to change them

| Choice | Default | Change it in |
| --- | --- | --- |
| Language model | Gemma 4 E2B Q4_K_M via `llama-server`, 2048 token context | `llm` in `~/.config/bloom/garden.json` |
| Speech to text | `ggml-base.en` via `whisper-server` | `stt` and `language` in `garden.json` |
| What the model is told | First-person inner voice, one question, at most 45 words | `~/.config/bloom/system_prompt.txt` |
| Reading speed | 270 words per minute | `wpm` in `garden.json` |
| Memory of the conversation | Last 6 exchanges, forgotten after 20 quiet minutes | `history_turns`, `session_idle_minutes` |
| Firmware updates | When you press "Update Ponds now" | `firmware.auto_install: true` makes Ponds install by themselves |

The model choice follows the measurements in [`../garden/g4q4-setup`](../garden/g4q4-setup):
E2B Q4_K_M runs fully on the Orin Nano Super's GPU and leaves room for speech
recognition in 8 GB.

## Known limits of this first version

- **English only on screen.** The Pond font has no Hangul or other non-Latin glyphs,
  and the default speech model is English. Garden reduces the model's text to ASCII
  before sending it.
- **No sound output.** The answer is read, not spoken.
- **The firmware has been compiled in CI but not yet run on a device.** Check the
  first-run list in [`pond/README.md`](pond/README.md) on real hardware.
- **Trust is the home network.** Anyone on the Wi-Fi can talk to Garden. Uploading
  firmware needs a token; the dashboard's control buttons only work on the Jetson.

## Layout

```text
install.sh                 one-line entry point (repository root)
v2/garden/install.sh       the seven setup steps on the Jetson
v2/garden/flash_pond.py    first USB flash of the Pond, with Wi-Fi
v2/garden/launcher/        desktop icon and start script
v2/garden/bloom_garden/    server, turn pipeline, model processes, dashboard
v2/pond/firmware/          ESP-IDF project
v2/pond/publish.sh         hand a firmware build to Garden
```
