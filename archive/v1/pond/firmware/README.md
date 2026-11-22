# Pond firmware proof

ESP-IDF 5.5.4 target: Waveshare ESP32-S3-Touch-AMOLED-1.75 standard board.

```bash
idf.py set-target esp32s3
idf.py build flash monitor
```

Implemented:

- Springboard boot with Pond, Particles, and Settings
- one-line Wordstream with automatic font fitting
- Particles driven by touch and both front ES7210 microphones
- real BSP brightness and persisted 0/90/180/270° rotation
- nearby Wi-Fi scan, network selection, circular English keyboard
- saved credentials and automatic reconnect
- configurable Garden LAN IP/hostname
- explicit record/I'm done, dual-mic downmix, 16 kHz WAV, HTTP turn
- right-swipe navigation without a permanent header or back button

`pony/` remains the working beta reference. This v1 firmware has not yet been
compiled or hardware-tested in this workspace because ESP-IDF is not installed
here; first physical validation should check mic channel order, Wi-Fi, and one
full Garden turn.
