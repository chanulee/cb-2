"""One Pond turn: PCM audio -> whisper.cpp -> llama.cpp -> streamed events."""

from __future__ import annotations

import io
import json
import re
import threading
import time
import unicodedata
import uuid
import wave
from typing import Iterable, Iterator
from urllib.request import Request, urlopen

from . import config as cfg

SAMPLE_RATE = 16000
MIN_AUDIO_SECONDS = 0.3
MAX_AUDIO_BYTES = SAMPLE_RATE * 2 * 90        # 90 s of 16-bit mono
MOCK_REPLY = (
    "I am testing Bloom without a model. This sentence is streamed word by word, "
    "so I can check the wordstream on my Pond. What do I want to try next?"
)

# Characters the Pond font (LVGL Montserrat, ASCII only) cannot draw.
_REPLACEMENTS = str.maketrans({
    "‘": "'", "’": "'", "“": '"', "”": '"',
    "–": "-", "—": " - ", "…": "...", " ": " ",
    "*": "", "#": "", "`": "", "_": " ",
})
_NON_SPEECH = re.compile(r"\[[^\]]*\]|\([^)]*\)")


def pcm_to_wav(pcm: bytes, sample_rate: int = SAMPLE_RATE) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(pcm)
    return buffer.getvalue()


def clean_transcript(text: str) -> str:
    """Drop whisper's non-speech markers such as [BLANK_AUDIO] or (wind blowing)."""
    return " ".join(_NON_SPEECH.sub(" ", text).split())


def display_text(text: str) -> str:
    """Reduce model output to the ASCII the Pond can render, without markdown."""
    text = unicodedata.normalize("NFKD", text.translate(_REPLACEMENTS))
    return "".join(char for char in text if char == "\n" or " " <= char <= "~")


def transcribe(config: dict, wav: bytes) -> str:
    """POST a WAV to whisper-server's /inference endpoint."""
    boundary = uuid.uuid4().hex
    fields = {"response_format": "json", "temperature": "0.0", "language": config["language"]}
    body = b"".join(
        f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode()
        for name, value in fields.items()
    )
    body += (
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="pond.wav"\r\n'
        "Content-Type: audio/wav\r\n\r\n"
    ).encode() + wav + f"\r\n--{boundary}--\r\n".encode()
    request = Request(
        f"{config['stt']['url'].rstrip('/')}/inference", data=body, method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    with urlopen(request, timeout=120) as response:  # noqa: S310 - local URL chosen by owner
        result = json.load(response)
    if "error" in result:
        raise RuntimeError(str(result["error"]))
    return clean_transcript(str(result.get("text", "")))


def chat_payload(config: dict, messages: list[dict]) -> dict:
    return {
        "model": "local",
        "messages": [{"role": "system", "content": cfg.system_prompt()}, *messages],
        "temperature": config["llm"]["temperature"],
        "max_tokens": config["llm"]["max_tokens"],
        "stream": True,
        # Gemma 4 can think before answering; Bloom wants the first word quickly.
        "reasoning_effort": "none",
        "chat_template_kwargs": {"enable_thinking": False},
    }


def parse_sse(lines: Iterable[bytes]) -> Iterator[str]:
    """Yield content deltas from an OpenAI-style chat completion stream."""
    for raw in lines:
        line = raw.strip()
        if not line.startswith(b"data:"):
            continue
        data = line[5:].strip()
        if data == b"[DONE]":
            return
        choices = json.loads(data).get("choices") or [{}]
        delta = (choices[0].get("delta") or {}).get("content")
        if delta:
            yield delta


def stream_chat(config: dict, messages: list[dict]) -> Iterator[str]:
    request = Request(
        f"{config['llm']['url'].rstrip('/')}/v1/chat/completions",
        data=json.dumps(chat_payload(config, messages)).encode(),
        headers={"Content-Type": "application/json"}, method="POST",
    )
    with urlopen(request, timeout=120) as response:  # noqa: S310 - local URL chosen by owner
        yield from parse_sse(response)


def mock_chat(_config: dict, _messages: list[dict]) -> Iterator[str]:
    for word in MOCK_REPLY.split(" "):
        time.sleep(0.05)
        yield word + " "


class Sessions:
    """Short conversation memory per Pond, forgotten after a pause."""

    def __init__(self, config: dict) -> None:
        self.keep = int(config["history_turns"]) * 2
        self.idle_seconds = float(config["session_idle_minutes"]) * 60
        self.data: dict[str, tuple[float, list[dict]]] = {}
        self.lock = threading.Lock()

    def history(self, device: str, now: float | None = None) -> list[dict]:
        now = time.time() if now is None else now
        with self.lock:
            seen, messages = self.data.get(device, (0.0, []))
            return list(messages) if now - seen <= self.idle_seconds else []

    def add(self, device: str, user: str, assistant: str, now: float | None = None) -> None:
        now = time.time() if now is None else now
        messages = self.history(device, now) + [
            {"role": "user", "content": user}, {"role": "assistant", "content": assistant},
        ]
        with self.lock:
            self.data[device] = (now, messages[-self.keep:] if self.keep else [])

    def reset(self) -> None:
        with self.lock:
            self.data.clear()


def run_turn(
    config: dict, sessions: Sessions, device: str,
    pcm: bytes | None = None, text: str = "", mock: bool = False,
) -> Iterator[dict]:
    """Yield the protocol events of one turn. Errors become a final error event."""
    started = time.monotonic()
    timing: dict[str, int] = {}

    def elapsed() -> int:
        return int((time.monotonic() - started) * 1000)

    try:
        transcript = text.strip()
        if not transcript:
            pcm = pcm or b""
            if len(pcm) < SAMPLE_RATE * 2 * MIN_AUDIO_SECONDS:
                yield {"type": "error", "message": "That was too short. Hold on a little longer."}
                return
            yield {"type": "stage", "stage": "transcribing"}
            transcript = "(mock transcript)" if mock else transcribe(config, pcm_to_wav(pcm))
            timing["stt_ms"] = elapsed()
        if not transcript:
            yield {"type": "error", "message": "I did not catch any words. Try again."}
            return
        yield {"type": "transcript", "text": transcript}
        yield {"type": "stage", "stage": "thinking"}

        messages = sessions.history(device) + [{"role": "user", "content": transcript}]
        reply = ""
        for delta in (mock_chat if mock else stream_chat)(config, messages):
            shown = display_text(delta)
            if not reply:
                shown = shown.lstrip()
                if not shown:
                    continue
                timing["first_word_ms"] = elapsed()
            reply += shown
            yield {"type": "delta", "text": shown}
        reply = reply.strip()
        if not reply:
            yield {"type": "error", "message": "The model returned nothing. Try again."}
            return
        sessions.add(device, transcript, reply)
        timing["total_ms"] = elapsed()
        yield {"type": "done", "text": reply, "timing": timing}
    except Exception as error:  # noqa: BLE001 - every failure must reach the Pond screen
        reason = getattr(error, "reason", error)
        yield {"type": "error", "message": f"Garden could not finish: {reason}"[:160]}
