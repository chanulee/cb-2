"""Tiny Garden HTTP server for the proof-of-concept loop."""

from __future__ import annotations

import argparse
import json
import mimetypes
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

from .inference import reflect, transcribe
from .runtime import Runtime
from .session import next_turn, opening_turn


STATIC_ROOT = Path(__file__).resolve().parent.parent / "static"
MAX_AUDIO_BYTES = 4 * 1024 * 1024
RUNTIME: Runtime | None = None


def safe_file(relative: str) -> Path | None:
    candidate = (STATIC_ROOT / unquote(relative)).resolve()
    try:
        candidate.relative_to(STATIC_ROOT.resolve())
    except ValueError:
        return None
    return candidate if candidate.is_file() else None


class Handler(BaseHTTPRequestHandler):
    def json(self, value: object, status: int = HTTPStatus.OK) -> None:
        body = json.dumps(value, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path == "/api/llama/status":
            self.json(RUNTIME.status() if RUNTIME else {"state": "unavailable"})
            return
        if path == "/api/health":
            self.json({"ok": True, "flow": "Pond WAV -> whisper.cpp -> Gemma 4"})
            return
        if path == "/api/start":
            self.json(opening_turn().to_dict())
            return

        relative = "index.html" if path == "/" else "dashboard.html" if path == "/dashboard" else path.lstrip("/")
        file = safe_file(relative)
        if file is None:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        body = file.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", mimetypes.guess_type(file.name)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/llama/"):
            self.llama_control(parsed.path)
            return
        if parsed.path != "/api/turn":
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 <= length <= MAX_AUDIO_BYTES:
                raise ValueError("audio must be at most 4 MiB")
            prompt_index = int(self.headers.get("X-Prompt-Index", "0"))
            transcript = unquote(self.headers.get("X-Debug-Transcript", ""))[:2000]
            audio = self.rfile.read(length)
            transcript = transcript.strip() or transcribe(audio)
            generated_prompt = reflect(transcript)
            self.json(next_turn(prompt_index, transcript, len(audio), generated_prompt).to_dict())
        except (TypeError, ValueError) as error:
            self.json({"error": str(error)}, HTTPStatus.BAD_REQUEST)
        except (OSError, RuntimeError, KeyError, IndexError) as error:
            self.json({"error": str(error)}, HTTPStatus.SERVICE_UNAVAILABLE)

    def llama_control(self, path: str) -> None:
        if self.headers.get("X-Bloom-Control") != "1" or RUNTIME is None:
            self.json({"error": "control request denied"}, HTTPStatus.FORBIDDEN)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 <= length <= 1024:
                raise ValueError("request is too large")
            data = json.loads(self.rfile.read(length) or b"{}")
            if path == "/api/llama/start":
                RUNTIME.start(str(data.get("model", "")), int(data.get("context", 2048)))
                self.json({"ok": True})
            elif path == "/api/llama/stop":
                RUNTIME.stop()
                self.json({"ok": True})
            elif path == "/api/llama/benchmark":
                self.json(RUNTIME.benchmark())
            else:
                self.json({"error": "unknown control"}, HTTPStatus.NOT_FOUND)
        except (TypeError, ValueError) as error:
            self.json({"error": str(error)}, HTTPStatus.BAD_REQUEST)
        except (OSError, RuntimeError, KeyError, IndexError) as error:
            self.json({"error": str(error)}, HTTPStatus.SERVICE_UNAVAILABLE)

    def log_message(self, message: str, *args: object) -> None:
        print(f"{self.client_address[0]} - {message % args}")


def run() -> None:
    global RUNTIME
    parser = argparse.ArgumentParser(description="Run BLOOM Garden")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    RUNTIME = Runtime()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"BLOOM Garden: http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        RUNTIME.close()
