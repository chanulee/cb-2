"""Child processes Garden keeps alive: llama-server, whisper-server, mDNS advert."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import threading
from collections import deque
from pathlib import Path
from urllib.error import URLError
from urllib.parse import urlparse
from urllib.request import urlopen

from . import config as cfg

MDNS_SERVICE = "_bloom._tcp"


def healthy(url: str, timeout: float = 0.5) -> bool:
    """True when a llama.cpp or whisper.cpp server answers at this base URL."""
    try:
        with urlopen(f"{url.rstrip('/')}/health", timeout=timeout) as response:
            return response.status == 200
    except (URLError, OSError, ValueError):
        return False


class Service:
    """One local model server. Adopts a server that is already running on its port."""

    def __init__(self, name: str, url: str) -> None:
        self.name = name
        self.url = url.rstrip("/")
        self.process: subprocess.Popen | None = None
        self.command: list[str] = []
        self.detail = ""
        self.log: deque[str] = deque(maxlen=80)
        self.lock = threading.Lock()

    def _pump(self, process: subprocess.Popen) -> None:
        assert process.stdout is not None
        for line in process.stdout:
            self.log.append(line.rstrip())

    def start(self, command: list[str], detail: str) -> None:
        with self.lock:
            self.detail = detail
            if self.process and self.process.poll() is None:
                return
            if healthy(self.url):
                self.detail = f"using the server already running at {self.url}"
                return
            self.command = command
            self.log.clear()
            self.process = subprocess.Popen(
                command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, bufsize=1, start_new_session=True,
            )
            threading.Thread(target=self._pump, args=(self.process,), daemon=True).start()

    def stop(self) -> None:
        with self.lock:
            process, self.process = self.process, None
        if process is None or process.poll() is not None:
            return
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=2)

    def state(self) -> str:
        """ready | loading | crashed | missing"""
        if healthy(self.url):
            return "ready"
        if self.process is None:
            return "missing"
        return "loading" if self.process.poll() is None else "crashed"

    def status(self) -> dict:
        return {"state": self.state(), "detail": self.detail, "log": list(self.log)[-12:]}


def llm_command(config: dict, binary: Path, model: Path) -> list[str]:
    """Settings validated on the Orin Nano Super 8 GB in archive/garden/g4q4-setup/run.sh."""
    address = urlparse(config["llm"]["url"])
    return [
        str(binary), "-m", str(model),
        "--host", address.hostname or "127.0.0.1", "--port", str(address.port or 8080),
        "--n-gpu-layers", "99", "--flash-attn", "on", "--parallel", "1",
        "--ctx-size", str(config["llm"]["ctx_size"]),
        "--threads", str(os.cpu_count() or 4),
        "--batch-size", "128", "--ubatch-size", "64", "--cache-ram", "0",
        *map(str, config["llm"]["extra_args"]),
    ]


def stt_command(config: dict, binary: Path, model: Path) -> list[str]:
    address = urlparse(config["stt"]["url"])
    return [
        str(binary), "-m", str(model),
        "--host", address.hostname or "127.0.0.1", "--port", str(address.port or 8081),
        "-l", config["language"], "-t", str(min(os.cpu_count() or 4, 4)),
        *map(str, config["stt"]["extra_args"]),
    ]


class Advert:
    """Publishes `_bloom._tcp` so Pond finds Garden without an IP address."""

    def __init__(self) -> None:
        self.process: subprocess.Popen | None = None
        self.detail = "not started"

    def start(self, port: int) -> None:
        tool = shutil.which("avahi-publish-service") or shutil.which("avahi-publish")
        if tool is None:
            self.detail = "avahi-utils is not installed; enter Garden's IP in Pond settings"
            return
        command = [tool, "Bloom Garden", MDNS_SERVICE, str(port), "path=/api/hello"]
        if tool.endswith("avahi-publish"):
            command.insert(1, "-s")
        self.process = subprocess.Popen(
            command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True
        )
        self.detail = f"advertising {MDNS_SERVICE} on port {port}"

    def stop(self) -> None:
        if self.process and self.process.poll() is None:
            self.process.terminate()
        self.process = None

    def status(self) -> dict:
        running = self.process is not None and self.process.poll() is None
        return {"state": "ready" if running else "missing", "detail": self.detail}


class Services:
    def __init__(self, config: dict, mock: bool = False) -> None:
        self.config = config
        self.mock = mock
        self.llm = Service("llm", config["llm"]["url"])
        self.stt = Service("stt", config["stt"]["url"])
        self.advert = Advert()

    def start(self) -> None:
        self.advert.start(int(self.config["port"]))
        if self.mock:
            self.llm.detail = self.stt.detail = "mock mode: no model is loaded"
            return
        for service, (binary, model), build, what in (
            (self.llm, cfg.find_llm(self.config), llm_command, "llama-server"),
            (self.stt, cfg.find_stt(self.config), stt_command, "whisper-server"),
        ):
            if binary is None or model is None:
                missing = what if binary is None else "a model file"
                service.detail = f"{missing} not found; run garden/install.sh"
                if healthy(service.url):
                    service.detail = f"using the server already running at {service.url}"
                continue
            service.start(build(self.config, binary, model), model.name)

    def stop(self) -> None:
        self.llm.stop()
        self.stt.stop()
        self.advert.stop()

    def status(self) -> dict:
        if self.mock:
            mock = {"state": "ready", "detail": "mock mode: no model is loaded", "log": []}
            return {"llm": mock, "stt": mock, "discovery": self.advert.status(), "mock": True}
        return {
            "llm": self.llm.status(), "stt": self.stt.status(),
            "discovery": self.advert.status(), "mock": False,
        }


def json_bytes(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()
