# Pond ↔ Garden protocol, version 1

HTTP/1.1 on port 8765, no TLS, home LAN only. Garden is the server.

## Discovery

Garden publishes the mDNS service `_bloom._tcp` on its port. The Pond sends a PTR query
for it and uses the first IPv4 answer. A Garden address typed in Pond Settings
(`host`, `host:port` or `http://host:port`) replaces discovery.

## `GET /api/hello`

Sent by the Pond every 30 seconds while idle (every 3 seconds until Garden is ready).

Request headers: `X-Bloom-Device: pond-a1b2c3`, `X-Bloom-Version: 0.1.0`.

```json
{
  "name": "bloom-garden", "version": "0.1.0", "protocol": 1,
  "ready": true,
  "wpm": 270,
  "opening": "What is on my mind right now?",
  "firmware": {
    "version": "0.1.0", "sha256": "64 hex characters", "size": 1630208,
    "url": "/firmware/pond.bin", "auto_install": true
  }
}
```

`ready` is false while the models load; the Pond then shows "Garden is loading its
models" and does not record. `firmware` is `null` when Garden holds no image.
`sha256` is the ELF hash inside the image (`esp_app_desc_t.app_elf_sha256`). The Pond
compares it with its own; if they differ, Garden's build is installed.

## `POST /api/turn`

Body: the recording as raw PCM, signed 16-bit little-endian, 16 kHz, mono, at most
90 seconds. `Content-Length` or chunked transfer encoding. Header `X-Bloom-Device`
selects the conversation memory.

Response: `200`, `Content-Type: application/x-ndjson`, chunked. One JSON object per
line, sent as soon as it exists:

| Line | Meaning |
| --- | --- |
| `{"type":"stage","stage":"transcribing"}` | speech to text has started |
| `{"type":"transcript","text":"I kept putting off a call."}` | what was heard |
| `{"type":"stage","stage":"thinking"}` | the language model has started |
| `{"type":"delta","text":" It seems"}` | next piece of the answer; concatenate all of them |
| `{"type":"done","text":"…","timing":{"stt_ms":410,"first_word_ms":980,"total_ms":2600}}` | complete answer |
| `{"type":"error","message":"I did not catch any words. Try again."}` | the turn ended; show the message |

Every stream ends with exactly one `done` or `error`. `delta` text is printable ASCII
only. Receivers must ignore types they do not know.

Try it without a Pond:

```bash
curl -N -X POST --data-binary @speech.raw http://jetson.local:8765/api/turn
curl -N -X POST -d '{"text":"I kept putting off a call."}' http://jetson.local:8765/api/text
```

`POST /api/text` takes `{"text": "..."}` in place of audio and answers with the same stream.

## Firmware

- `GET /firmware/pond.bin` returns the application image (`build/bloom-pond.bin`).
- `POST /api/firmware` with header `X-Bloom-Token` and the image as body replaces it.
  The token is `upload_token` in `~/.config/bloom/garden.json`.

## Dashboard

`GET /` and `GET /api/status` serve the dashboard. `POST /api/control/{quit,
restart-models,forget,fetch-firmware}` are accepted from the Jetson itself only.
