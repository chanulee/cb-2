"""Minimal llama-server lifecycle and Jetson telemetry."""

from __future__ import annotations

import json
import os
import re
import socket
import subprocess
import threading
import time
from collections import deque
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen


LLAMA_BIN = Path(os.environ.get(
    "BLOOM_LLAMA_BIN",
    "/home/chanwoo/.gemini/antigravity/scratch/llama.cpp/build/bin/llama-server",
))
MODEL_DIR = Path(os.environ.get(
    "BLOOM_MODEL_DIR",
    "/home/chanwoo/.gemini/antigravity/scratch/models",
))
LLAMA_URL = "http://127.0.0.1:8080"
CONTEXTS = {2048, 4096}


def parse_tegrastats(line: str) -> dict[str, float | int | str]:
    """Extract the few values the dashboard displays."""
    result: dict[str, float | int | str] = {"raw": line.strip()}
    patterns = {
        "ram": r"RAM (\d+)/(\d+)MB",
        "swap": r"SWAP (\d+)/(\d+)MB",
        "gpu": r"GR3D_FREQ (\d+)%",
        "temp": r"gpu@(\d+(?:\.\d+)?)C",
        "power": r"VDD_IN (\d+)mW",
    }
    for name, pattern in patterns.items():
        match = re.search(pattern, line)
        if not match:
            continue
        values = [float(value) if "." in value else int(value) for value in match.groups()]
        if name in {"ram", "swap"}:
            result[f"{name}_used_mb"], result[f"{name}_total_mb"] = values
        else:
            result[name] = values[0]
    cpu = re.search(r"CPU \[([^]]+)]", line)
    loads = [int(value) for value in re.findall(r"(\d+)%", cpu.group(1))] if cpu else []
    result["cpu"] = round(sum(loads) / len(loads), 1) if loads else 0
    return result


def parse_prometheus(text: str) -> dict[str, float]:
    values: dict[str, float] = {}
    for line in text.splitlines():
        if line.startswith("llamacpp:"):
            name, value = line.split(None, 1)
            values[name.removeprefix("llamacpp:")] = float(value)
    return values


def process_rss_mb(pid: int) -> int:
    try:
        text = Path(f"/proc/{pid}/status").read_text()
        return int(re.search(r"VmRSS:\s+(\d+)", text).group(1)) // 1024  # type: ignore[union-attr]
    except (FileNotFoundError, AttributeError):
        return 0


class Runtime:
    def __init__(self) -> None:
        self.process: subprocess.Popen[str] | None = None
        self.telemetry: subprocess.Popen[str] | None = None
        self.model = ""
        self.context = 2048
        self.log: deque[str] = deque(maxlen=60)
        self.tegra: dict[str, float | int | str] = {}
        self.lifecycle = threading.Lock()

    def models(self) -> list[dict[str, str | int]]:
        return [
            {"name": path.name, "size_mb": round(path.stat().st_size / 1024 / 1024)}
            for path in sorted(MODEL_DIR.glob("*.gguf"))
        ]

    def _read_lines(self, process: subprocess.Popen[str], telemetry: bool = False) -> None:
        assert process.stdout is not None
        for line in process.stdout:
            if telemetry:
                self.tegra = parse_tegrastats(line)
            else:
                self.log.append(line.rstrip())

    def ensure_telemetry(self) -> None:
        if self.telemetry and self.telemetry.poll() is None:
            return
        try:
            self.telemetry = subprocess.Popen(
                ["tegrastats", "--interval", "1000"], stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT, text=True, bufsize=1,
            )
            threading.Thread(target=self._read_lines, args=(self.telemetry, True), daemon=True).start()
        except FileNotFoundError:
            self.tegra = {"raw": "tegrastats is not installed"}

    def _stop_locked(self) -> None:
        process = self.process
        if not process or process.poll() is not None:
            self.process = None
            return
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=2)
        self.process = None

    def start(self, model: str, context: int) -> None:
        choices = {item["name"] for item in self.models()}
        if model not in choices or context not in CONTEXTS:
            raise ValueError("Unknown model or context size")
        if not LLAMA_BIN.is_file():
            raise RuntimeError(f"llama-server not found: {LLAMA_BIN}")
        with self.lifecycle:
            self._stop_locked()
            try:
                with socket.create_connection(("127.0.0.1", 8080), timeout=0.2):
                    raise RuntimeError("port 8080 already has another server")
            except (ConnectionRefusedError, TimeoutError, OSError):
                pass
            self.model, self.context = model, context
            self.log.clear()
            command = [
                str(LLAMA_BIN), "-m", str(MODEL_DIR / model),
                "--host", "127.0.0.1", "--port", "8080",
                "--ctx-size", str(context), "--parallel", "1",
                "--threads", "6", "--batch-size", "128", "--ubatch-size", "64",
                "--metrics",
            ]
            self.process = subprocess.Popen(
                command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, bufsize=1, start_new_session=True,
            )
            threading.Thread(target=self._read_lines, args=(self.process,), daemon=True).start()

    def stop(self) -> None:
        with self.lifecycle:
            self._stop_locked()

    def _llama_get(self, path: str, timeout: float = 0.35) -> str:
        with urlopen(f"{LLAMA_URL}{path}", timeout=timeout) as response:
            return response.read().decode()

    def ready(self) -> bool:
        try:
            return json.loads(self._llama_get("/health"))["status"] == "ok"
        except (URLError, TimeoutError, OSError, KeyError, json.JSONDecodeError):
            return False

    def status(self) -> dict[str, object]:
        self.ensure_telemetry()
        process = self.process
        running = process is not None and process.poll() is None
        metrics: dict[str, float] = {}
        if self.ready():
            try:
                metrics = parse_prometheus(self._llama_get("/metrics"))
            except (URLError, TimeoutError, OSError, ValueError):
                pass
        state = "ready" if running and metrics else "loading" if running else "stopped"
        if process is not None and process.poll() is not None:
            state = "crashed"
        return {
            "state": state, "pid": process.pid if running else None,
            "model": self.model, "context": self.context, "models": self.models(),
            "process_rss_mb": process_rss_mb(process.pid) if running else 0,
            "system": self.tegra, "metrics": metrics, "log": list(self.log)[-30:],
        }

    def benchmark(self) -> dict[str, object]:
        if not self.ready():
            raise RuntimeError("llama-server is not ready")
        payload = json.dumps({
            "model": "local", "messages": [{"role": "user", "content": "In one sentence, describe a quiet garden."}],
            "temperature": 0, "max_tokens": 32,
            "chat_template_kwargs": {"enable_thinking": False},
        }).encode()
        started = time.monotonic()
        request = Request(f"{LLAMA_URL}/v1/chat/completions", data=payload,
                          headers={"Content-Type": "application/json"}, method="POST")
        with urlopen(request, timeout=120) as response:
            result = json.load(response)
        return {
            "seconds": round(time.monotonic() - started, 2),
            "text": result["choices"][0]["message"]["content"].strip(),
        }

    def close(self) -> None:
        self.stop()
        if self.telemetry and self.telemetry.poll() is None:
            self.telemetry.terminate()
