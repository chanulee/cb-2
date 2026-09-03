"""Local whisper.cpp and llama.cpp adapters; no BLOOM state lives here."""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
from pathlib import Path
from urllib.request import Request, urlopen


def transcribe(audio: bytes) -> str:
    """Run whisper.cpp for a Pond WAV, or return empty when STT is not configured."""
    binary = os.environ.get("BLOOM_WHISPER_BIN", "")
    model = os.environ.get("BLOOM_WHISPER_MODEL", "")
    if not binary or not model:
        return ""
    if not audio.startswith(b"RIFF"):
        raise ValueError("Pond must upload a WAV file when local STT is enabled")

    with tempfile.TemporaryDirectory(prefix="bloom-turn-") as directory:
        root = Path(directory)
        wav = root / "pond.wav"
        output = root / "transcript"
        wav.write_bytes(audio)
        completed = subprocess.run(
            [binary, "-m", model, "-f", str(wav), "-l", "en", "-nt", "-otxt", "-of", str(output)],
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
        if completed.returncode != 0:
            detail = completed.stderr.strip().splitlines()[-1:] or ["whisper.cpp failed"]
            raise RuntimeError(detail[0])
        return output.with_suffix(".txt").read_text(encoding="utf-8").strip()[:2000]


def chat_payload(transcript: str) -> dict[str, object]:
    """Pure request builder: Garden asks for the user's inner voice, not an AI persona."""
    return {
        "model": "local",
        "messages": [
            {
                "role": "system",
                "content": (
                    "Return exactly one concise first-person reflective question as the user's "
                    "inner voice. Do not explain or show reasoning. Never mention AI. Use plain "
                    "English and at most 25 words. Output only the question."
                ),
            },
            {"role": "user", "content": f"My reflection: {transcript.strip()}"},
        ],
        "temperature": 0.7,
        "max_tokens": 64,
        "reasoning_effort": "none",
        "chat_template_kwargs": {"enable_thinking": False},
    }


def reflect(transcript: str) -> str:
    """Ask a local llama-server for the next question, or return empty when disabled."""
    base_url = os.environ.get("BLOOM_LLAMA_URL", "").rstrip("/")
    if not base_url or not transcript.strip():
        return ""
    request = Request(
        f"{base_url}/v1/chat/completions",
        data=json.dumps(chat_payload(transcript)).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=120) as response:  # noqa: S310 - local URL chosen by owner
        result = json.load(response)
    return str(result["choices"][0]["message"]["content"]).strip()[:240]
