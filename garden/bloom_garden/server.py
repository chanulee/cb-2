"""Garden HTTP server: the Pond protocol, firmware hosting and the dashboard."""

from __future__ import annotations

import argparse
import hmac
import json
import mimetypes
import signal
import socket
import threading
import time
import webbrowser
from collections import deque
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Iterable, Iterator
from urllib.error import URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from . import PROTOCOL, __version__
from . import config as cfg
from .firmware import MAX_IMAGE_BYTES, Store
from .pipeline import MAX_AUDIO_BYTES, Sessions, run_turn
from .services import Services, json_bytes

STATIC_ROOT = Path(__file__).resolve().parent / "static"
LOOPBACK = {"127.0.0.1", "::1", "::ffff:127.0.0.1"}


class Garden:
    """Everything the request handlers share."""

    def __init__(self, config: dict, mock: bool = False) -> None:
        self.config = config
        self.mock = mock
        self.services = Services(config, mock)
        self.sessions = Sessions(config)
        self.firmware = Store(cfg.data_dir(config) / "firmware")
        self.ponds: dict[str, dict] = {}
        self.turns: deque[dict] = deque(maxlen=20)
        self.turn_lock = threading.Lock()
        self.started = time.time()

    def ready(self) -> bool:
        return self.mock or (
            self.services.llm.state() == "ready" and self.services.stt.state() == "ready"
        )

    def firmware_offer(self) -> dict | None:
        info = self.firmware.info()
        if info is None:
            return None
        return {**info, "url": "/firmware/pond.bin",
                "auto_install": bool(self.config["firmware"]["auto_install"])}

    def hello(self, device: str, version: str, address: str) -> dict:
        if device:
            self.ponds[device] = {"address": address, "version": version, "seen": time.time()}
        return {
            "name": "bloom-garden", "version": __version__, "protocol": PROTOCOL,
            "ready": self.ready(), "wpm": int(self.config["wpm"]),
            "opening": self.config["opening"], "firmware": self.firmware_offer(),
        }

    def push_update(self) -> dict:
        """Tell every Pond seen in the last two minutes to install Garden's firmware now."""
        offer = self.firmware_offer()
        if offer is None:
            raise ValueError("Garden has no Pond firmware to push")
        results = {}
        for device, pond in list(self.ponds.items()):
            if time.time() - pond["seen"] > 120:
                continue
            try:
                request = Request(f"http://{pond['address']}/api/update", data=b"{}", method="POST")
                with urlopen(request, timeout=5) as response:  # noqa: S310 - address the Pond gave
                    current = json.load(response).get("sha256") == offer["sha256"]
                results[device] = "already current" if current else "updating"
            except (URLError, OSError, ValueError):
                results[device] = "did not answer"
        return {"version": offer["version"], "ponds": results}

    def status(self) -> dict:
        return {
            "version": __version__, "uptime_s": int(time.time() - self.started),
            "hostname": socket.gethostname(), "port": self.config["port"],
            "wpm": int(self.config["wpm"]), "config_path": str(cfg.CONFIG_PATH),
            "services": self.services.status(), "ready": self.ready(),
            "ponds": [{"id": device, **pond, "age_s": int(time.time() - pond["seen"])}
                      for device, pond in self.ponds.items()],
            "firmware": self.firmware_offer(),
            "firmware_repo": self.config["firmware"]["github_repo"],
            "turns": list(self.turns),
        }

    def turn(self, device: str, pcm: bytes | None = None, text: str = "") -> Iterator[dict]:
        """Run one turn at a time and keep it in the dashboard's recent list."""
        if not self.ready():
            yield {"type": "error", "message": "Garden's models are not loaded yet."}
            return
        if not self.turn_lock.acquire(blocking=False):
            yield {"type": "error", "message": "Garden is busy with another turn."}
            return
        record = {"time": time.time(), "device": device, "transcript": "", "reply": "",
                  "error": "", "timing": {}, "audio_s": round(len(pcm or b"") / 32000, 1)}
        try:
            for event in run_turn(self.config, self.sessions, device, pcm, text, self.mock):
                if event["type"] == "transcript":
                    record["transcript"] = event["text"]
                elif event["type"] == "done":
                    record["reply"], record["timing"] = event["text"], event["timing"]
                elif event["type"] == "error":
                    record["error"] = event["message"]
                yield event
        finally:
            self.turns.appendleft(record)
            self.turn_lock.release()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = f"BloomGarden/{__version__}"
    garden: Garden

    # ---- helpers -------------------------------------------------------------
    def send_bytes(self, body: bytes, content_type: str, status: int = HTTPStatus.OK) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, value: object, status: int = HTTPStatus.OK) -> None:
        self.send_bytes(json_bytes(value), "application/json; charset=utf-8", status)

    def send_events(self, events: Iterable[dict]) -> None:
        """Stream newline-delimited JSON with chunked transfer encoding."""
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
        self.send_header("Transfer-Encoding", "chunked")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        try:
            for event in events:
                line = json_bytes(event) + b"\n"
                self.wfile.write(b"%x\r\n%s\r\n" % (len(line), line))
                self.wfile.flush()
            self.wfile.write(b"0\r\n\r\n")
        except (BrokenPipeError, ConnectionResetError):
            for _ in events:    # let the turn finish so it is logged and unlocked
                pass

    def read_body(self, limit: int) -> bytes:
        if "chunked" in self.headers.get("Transfer-Encoding", "").lower():
            body = bytearray()
            while True:
                size = int(self.rfile.readline().split(b";")[0].strip() or b"0", 16)
                if size == 0:
                    self.rfile.readline()
                    return bytes(body)
                if len(body) + size > limit:
                    raise ValueError("request body is too large")
                body += self.rfile.read(size)
                self.rfile.readline()
        length = int(self.headers.get("Content-Length", "0"))
        if not 0 <= length <= limit:
            raise ValueError("request body is too large")
        return self.rfile.read(length)

    def is_local(self) -> bool:
        return self.client_address[0] in LOOPBACK

    def device(self) -> str:
        return self.headers.get("X-Bloom-Device", "")[:32] or f"web-{self.client_address[0]}"

    # ---- routes --------------------------------------------------------------
    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path == "/api/hello":
            self.send_json(self.garden.hello(
                self.headers.get("X-Bloom-Device", "")[:32],
                self.headers.get("X-Bloom-Version", "")[:32], self.client_address[0],
            ))
        elif path == "/api/status":
            self.send_json(self.garden.status())
        elif path == "/firmware/pond.bin":
            store = self.garden.firmware
            if store.info() is None:
                self.send_json({"error": "Garden has no Pond firmware"}, HTTPStatus.NOT_FOUND)
            else:
                self.send_bytes(store.path.read_bytes(), "application/octet-stream")
        else:
            name = "index.html" if path == "/" else path.lstrip("/")
            file = (STATIC_ROOT / name).resolve()
            if STATIC_ROOT.resolve() not in file.parents or not file.is_file():
                self.send_json({"error": "not found"}, HTTPStatus.NOT_FOUND)
                return
            self.send_bytes(file.read_bytes(), mimetypes.guess_type(file.name)[0] or "text/plain")

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        try:
            if path == "/api/turn":
                pcm = self.read_body(MAX_AUDIO_BYTES)
                self.send_events(self.garden.turn(self.device(), pcm=pcm))
            elif path == "/api/text":
                text = str(json.loads(self.read_body(8192) or b"{}").get("text", ""))[:2000]
                self.send_events(self.garden.turn(self.device(), text=text))
            elif path == "/api/firmware":
                token = self.headers.get("X-Bloom-Token", "")
                if not hmac.compare_digest(token, self.garden.config["upload_token"]):
                    self.close_connection = True    # the unread body must not be parsed as a request
                    self.send_json({"error": "wrong upload token"}, HTTPStatus.FORBIDDEN)
                    return
                saved = self.garden.firmware.save(self.read_body(MAX_IMAGE_BYTES))
                if self.headers.get("X-Bloom-Push") == "1":
                    saved["pushed"] = self.garden.push_update()["ponds"]
                self.send_json(saved)
            elif path.startswith("/api/control/"):
                self.control(path.rsplit("/", 1)[1])
            else:
                self.send_json({"error": "not found"}, HTTPStatus.NOT_FOUND)
        except (ValueError, KeyError, TypeError) as error:
            self.close_connection = True
            self.send_json({"error": str(error)}, HTTPStatus.BAD_REQUEST)
        except (OSError, RuntimeError, URLError) as error:
            self.close_connection = True
            self.send_json({"error": str(error)}, HTTPStatus.SERVICE_UNAVAILABLE)

    def control(self, action: str) -> None:
        """Dashboard buttons. Only the Jetson itself may use them."""
        if not self.is_local():
            self.send_json({"error": "controls only work on the Garden itself"}, HTTPStatus.FORBIDDEN)
            return
        self.read_body(1024)
        garden = self.garden
        if action == "quit":
            self.send_json({"ok": True})
            threading.Thread(target=self.server.shutdown, daemon=True).start()
        elif action == "restart-models":
            garden.services.llm.stop()
            garden.services.stt.stop()
            garden.services.start()
            self.send_json({"ok": True})
        elif action == "forget":
            garden.sessions.reset()
            self.send_json({"ok": True})
        elif action == "push-firmware":
            self.send_json(garden.push_update())
        elif action == "fetch-firmware":
            self.send_json(garden.firmware.fetch_release(garden.config["firmware"]["github_repo"]))
        else:
            self.send_json({"error": "unknown control"}, HTTPStatus.NOT_FOUND)

    def log_message(self, message: str, *args: object) -> None:
        if "/api/status" not in str(args[0] if args else ""):
            print(f"{time.strftime('%H:%M:%S')} {self.client_address[0]} {message % args}", flush=True)


def running(port: int) -> bool:
    try:
        with urlopen(f"http://127.0.0.1:{port}/api/status", timeout=1) as response:
            return "services" in json.load(response)
    except (URLError, OSError, ValueError):
        return False


def main() -> int:
    parser = argparse.ArgumentParser(prog="bloom_garden", description="Run the Bloom Garden")
    parser.add_argument("--host", help="address to listen on (default from config: 0.0.0.0)")
    parser.add_argument("--port", type=int, help="port to listen on (default from config: 8765)")
    parser.add_argument("--mock", action="store_true", help="answer with canned text, load no model")
    parser.add_argument("--open", action="store_true", help="open the dashboard in a browser")
    parser.add_argument("--stop", action="store_true", help="stop the Garden that is running")
    args = parser.parse_args()

    config = cfg.load()
    if args.host:
        config["host"] = args.host
    if args.port:
        config["port"] = args.port
    port = int(config["port"])
    dashboard = f"http://127.0.0.1:{port}/"

    if args.stop:
        if running(port):
            urlopen(Request(f"{dashboard}api/control/quit", data=b"{}", method="POST"), timeout=5)
            print("Bloom Garden stopped.")
        else:
            print("Bloom Garden is not running.")
        return 0
    if running(port):
        print(f"Bloom Garden is already running: {dashboard}")
        if args.open:
            webbrowser.open(dashboard)
        return 0

    garden = Garden(config, args.mock)
    Handler.garden = garden
    ThreadingHTTPServer.daemon_threads = True
    server = ThreadingHTTPServer((config["host"], port), Handler)
    signal.signal(signal.SIGTERM, lambda *_: threading.Thread(target=server.shutdown, daemon=True).start())
    garden.services.start()
    print(f"Bloom Garden {__version__}: {dashboard}" + ("  (mock mode)" if args.mock else ""), flush=True)
    if args.open:
        threading.Timer(0.5, webbrowser.open, [dashboard]).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        garden.services.stop()
    return 0
