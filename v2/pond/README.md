# Pond

Firmware for the Waveshare ESP32-S3 Touch AMOLED 1.75 (466 × 466 round AMOLED, two
microphones on an ES7210, 16 MB flash, 8 MB PSRAM).

Most people never build this: `install.sh` flashes the released image over USB-C, and
Garden delivers later versions over Wi-Fi.

## Using it

| Control | Does |
| --- | --- |
| **Speak** button, or BOOT button on the side | start recording (up to 60 s) |
| **Done** / BOOT | send the recording to Garden |
| **Stop** / BOOT | stop the answer that is being shown |
| Gear at the top | Settings: brightness, Wi-Fi, firmware update |
| Swipe right | back |

The line under the wordstream says what the Pond is waiting for: "Joining Wi-Fi...",
"Looking for Garden...", "Garden is loading its models" or "Press to speak".

## Build

ESP-IDF 5.5 (the `release/v5.5` branch).

```bash
cd v2/pond/firmware
idf.py build
idf.py -p /dev/ttyACM0 flash monitor     # USB-C; hold BOOT while plugging in if it is not found
```

A build made this way keeps the Wi-Fi stored on the device. For the image
`flash_pond.py` and the releases use, also run
`(cd build && python -m esptool --chip esp32s3 merge_bin -o bloom-pond-factory.bin @flash_args)`.

## Updating over Wi-Fi

```bash
idf.py build
../publish.sh                       # on the Jetson
../publish.sh jetson.local TOKEN    # from a laptop; TOKEN is upload_token in garden.json
```

`publish.sh` uploads `build/bloom-pond.bin` to Garden, and Garden pushes it: each Pond
shows "Updating to …", writes the image to its spare slot and restarts. That takes
about a minute.

For everyone else: push a tag `pond-vX.Y.Z` that matches `firmware/version.txt`. CI
builds it and publishes a GitHub release. In the dashboard on the Jetson, press "Get
latest release from GitHub", then **Update Ponds now**.

A Pond never updates on its own unless `"firmware": {"auto_install": true}` is set in
`garden.json`. Pond Settings also has an "Update to …" button.

Safety:

- Two 6 MB app slots (`partitions.csv`); the running one is never overwritten.
- A new build must join Wi-Fi, or run for a minute, before it is kept. If it resets
  before that, the bootloader boots the previous build.
- With `auto_install`, a build that was rolled back is not installed again by itself.
  A push or Settings → "Update to …" still installs it.

## Source

| File | Job |
| --- | --- |
| `main.cpp` | start-up; background check of Wi-Fi, Garden and updates; BOOT button |
| `ui.cpp` | screens and the idle → listening → thinking → reading states |
| `wordstream.cpp` | speed-reading display with a fixed pivot letter |
| `turn.cpp` | record, upload, parse the streamed answer |
| `mic.c` | ES7210 at 16 kHz, both microphones averaged to mono |
| `garden.cpp` | mDNS discovery and `/api/hello` |
| `ota.cpp` | download, flash, confirm or roll back |
| `push.cpp` | port 80 listener for Garden's "update now" signal |
| `network.cpp`, `settings.cpp` | Wi-Fi and stored settings (NVS namespace `bloom`) |

## First run on real hardware

This firmware compiles in CI. These points depend on the board and still need a
check on a device:

1. **Microphones.** Recording assumes the two front microphones are ES7210 inputs 1
   and 2. If recordings are silent or half as loud as expected, look at `mic.c`.
2. **USB console.** Logs are sent to the ESP32-S3's built-in USB serial port.
3. **Touch layout.** Button and keyboard positions were set for the round 466 px
   screen without seeing it.
4. **BOOT button.** GPIO 0 is read as the talk button.
