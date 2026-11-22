#!/usr/bin/env python3
"""Measure Gemma E2B Q4_K_M and CPU SenseVoiceSmall while both stay loaded."""

from __future__ import annotations

import argparse
import json
import os
import re
import signal
import subprocess
import sys
import threading
import time
import wave
from pathlib import Path
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "v1/garden"))
from bloom_garden.runtime import parse_tegrastats, process_rss_mb  # noqa: E402


SCRATCH = Path(os.environ.get(
    "BLOOM_SCRATCH_DIR", str(Path.home() / ".gemini/antigravity/scratch")
))
DEFAULT_LLAMA = SCRATCH / "llama.cpp/build/bin/llama-server"
DEFAULT_GEMMA = SCRATCH / "models/gemma-4-E2B-it-Q4_K_M.gguf"
DEFAULT_SENSE = SCRATCH / (
    "models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17"
)


def meminfo() -> dict[str, int]:
    values = {
        key: int(value)
        for key, value in re.findall(r"^(\w+):\s+(\d+) kB$", Path("/proc/meminfo").read_text(), re.M)
    }
    return {
        "ram_used_mb": (values["MemTotal"] - values["MemAvailable"]) // 1024,
        "ram_available_mb": values["MemAvailable"] // 1024,
        "swap_used_mb": (values["SwapTotal"] - values["SwapFree"]) // 1024,
    }


def stop_existing_llama() -> list[int]:
    """Stop only current-user llama-server processes, never unrelated services."""
    targets: list[int] = []
    for status in Path("/proc").glob("[0-9]*/status"):
        try:
            text = status.read_text()
            name = re.search(r"^Name:\s+(\S+)", text, re.M).group(1)  # type: ignore[union-attr]
            uid = int(re.search(r"^Uid:\s+(\d+)", text, re.M).group(1))  # type: ignore[union-attr]
            if name == "llama-server" and uid == os.getuid():
                targets.append(int(status.parent.name))
        except (FileNotFoundError, PermissionError, AttributeError):
            pass
    stopped = list(targets)
    for pid in targets:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    deadline = time.monotonic() + 8
    while targets and time.monotonic() < deadline:
        targets = [pid for pid in targets if Path(f"/proc/{pid}").exists()]
        time.sleep(0.1)
    for pid in targets:
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    return stopped


class Monitor:
    def __init__(self, llama: subprocess.Popen[str]) -> None:
        self.llama = llama
        self.tegra: dict[str, object] = {}
        self.peak: dict[str, int] = {}
        self.lock = threading.Lock()
        self.stop = threading.Event()
        self.tegra_process: subprocess.Popen[str] | None = None
        self.thread = threading.Thread(target=self._sample, daemon=True)

    def start(self) -> None:
        try:
            self.tegra_process = subprocess.Popen(
                ["tegrastats", "--interval", "200"], stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT, text=True, bufsize=1,
            )
            threading.Thread(target=self._read_tegra, daemon=True).start()
        except FileNotFoundError:
            pass
        self.thread.start()

    def _read_tegra(self) -> None:
        assert self.tegra_process and self.tegra_process.stdout
        for line in self.tegra_process.stdout:
            with self.lock:
                self.tegra = parse_tegrastats(line)

    def _sample(self) -> None:
        while not self.stop.wait(0.1):
            sample = meminfo() | {
                "llama_rss_mb": process_rss_mb(self.llama.pid),
                "benchmark_rss_mb": process_rss_mb(os.getpid()),
            }
            with self.lock:
                for key, value in sample.items():
                    self.peak[key] = max(self.peak.get(key, 0), value)

    def checkpoint(self, name: str) -> dict[str, object]:
        time.sleep(0.5)
        with self.lock:
            result: dict[str, object] = {"stage": name} | meminfo() | {
                "llama_rss_mb": process_rss_mb(self.llama.pid),
                "benchmark_rss_mb": process_rss_mb(os.getpid()),
                "peak": dict(self.peak),
                "tegrastats": dict(self.tegra),
            }
            self.peak.clear()
        return result

    def close(self) -> None:
        self.stop.set()
        self.thread.join(timeout=1)
        if self.tegra_process and self.tegra_process.poll() is None:
            self.tegra_process.terminate()
            self.tegra_process.wait(timeout=2)


def wait_for_llama(process: subprocess.Popen[str], timeout: int = 180) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("llama-server exited while loading")
        try:
            with urlopen("http://127.0.0.1:8080/health", timeout=1) as response:
                if json.load(response).get("status") == "ok":
                    return
        except (OSError, ValueError):
            time.sleep(0.5)
    raise TimeoutError("llama-server was not ready after 180 seconds")


def read_wav(path: Path):
    import numpy as np

    with wave.open(str(path), "rb") as source:
        if (source.getnchannels(), source.getsampwidth(), source.getframerate()) != (1, 2, 16000):
            raise ValueError("test WAV must be mono 16-bit PCM at 16 kHz")
        return np.frombuffer(source.readframes(source.getnframes()), dtype=np.int16).astype(np.float32) / 32768


def transcribe(recognizer, samples) -> tuple[str, float]:
    started = time.monotonic()
    stream = recognizer.create_stream()
    stream.accept_waveform(16000, samples)
    recognizer.decode_stream(stream)
    return stream.result.text.strip(), time.monotonic() - started


def prompt_gemma() -> tuple[str, float]:
    payload = json.dumps({
        "model": "local",
        "messages": [{"role": "user", "content": "Reply with exactly: stack test passed"}],
        "temperature": 0,
        "max_tokens": 16,
        "chat_template_kwargs": {"enable_thinking": False},
    }).encode()
    request = Request(
        "http://127.0.0.1:8080/v1/chat/completions", data=payload,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    started = time.monotonic()
    with urlopen(request, timeout=120) as response:
        result = json.load(response)
    return result["choices"][0]["message"]["content"].strip(), time.monotonic() - started


def terminate(process: subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return
    os.killpg(process.pid, signal.SIGTERM)
    try:
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait(timeout=2)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--llama-bin", type=Path, default=DEFAULT_LLAMA)
    parser.add_argument("--gemma", type=Path, default=DEFAULT_GEMMA)
    parser.add_argument("--sense-dir", type=Path, default=DEFAULT_SENSE)
    parser.add_argument("--wav", type=Path, help="defaults to SenseVoice's bundled en.wav")
    parser.add_argument("--language", default="en", help="SenseVoice language: en, ko, or auto")
    parser.add_argument("--threads", type=int, default=2)
    parser.add_argument("--output", type=Path, default=Path("/tmp/bloom-stack-benchmark.json"))
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        assert meminfo()["ram_available_mb"] > 0
        assert process_rss_mb(os.getpid()) > 0
        print("self-test passed")
        return

    model = args.sense_dir / "model.int8.onnx"
    tokens = args.sense_dir / "tokens.txt"
    wav = args.wav or args.sense_dir / "test_wavs/en.wav"
    for path in (args.llama_bin, args.gemma, model, tokens, wav):
        if not path.is_file():
            raise SystemExit(f"missing: {path}")
    if args.threads < 1:
        raise SystemExit("--threads must be positive")

    stopped = stop_existing_llama()
    baseline = {"stage": "baseline"} | meminfo() | {
        "llama_rss_mb": 0,
        "benchmark_rss_mb": process_rss_mb(os.getpid()),
        "peak": {},
        "tegrastats": {},
    }
    log_path = args.output.with_suffix(".llama.log")
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log = log_path.open("w")
    command = [
        str(args.llama_bin), "-m", str(args.gemma),
        "--host", "127.0.0.1", "--port", "8080",
        "--n-gpu-layers", "99", "--flash-attn", "on",
        "--parallel", "1", "--ctx-size", "2048", "--threads", "6",
        "--batch-size", "128", "--ubatch-size", "64", "--cache-ram", "0", "--metrics",
    ]
    llama = subprocess.Popen(
        command, stdout=log, stderr=subprocess.STDOUT, text=True, start_new_session=True,
    )
    monitor = Monitor(llama)
    monitor.start()
    stages: list[dict[str, object]] = [baseline]
    try:
        wait_for_llama(llama)
        stages.append(monitor.checkpoint("gemma_ready_after_load"))

        try:
            import sherpa_onnx
        except ImportError as error:
            raise RuntimeError("install the CPU package first: pip install sherpa-onnx") from error
        recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
            model=str(model), tokens=str(tokens), num_threads=args.threads,
            provider="cpu", language=args.language, use_itn=True, debug=False,
        )
        stages.append(monitor.checkpoint("gemma_and_sensevoice_ready"))

        samples = read_wav(wav)
        cold_text, cold_seconds = transcribe(recognizer, samples)
        stages.append(monitor.checkpoint("stt_cold"))
        warm_text, warm_seconds = transcribe(recognizer, samples)
        stages.append(monitor.checkpoint("stt_warm"))
        reply, llm_seconds = prompt_gemma()
        stages.append(monitor.checkpoint("llm_with_sensevoice_resident"))

        report = {
            "hardware": {"memory_total_mb": meminfo()["ram_used_mb"] + meminfo()["ram_available_mb"]},
            "models": {"gemma": str(args.gemma), "sensevoice": str(model)},
            "settings": {
                "sensevoice_provider": "cpu", "sensevoice_threads": args.threads,
                "sensevoice_language": args.language, "context": 2048,
                "llama_prompt_cache_mb": 0,
            },
            "stopped_llama_pids": stopped,
            "audio": {"path": str(wav), "seconds": round(len(samples) / 16000, 3)},
            "results": {
                "stt_cold_seconds": round(cold_seconds, 3), "stt_cold_text": cold_text,
                "stt_cold_rtf": round(cold_seconds / (len(samples) / 16000), 3),
                "stt_warm_seconds": round(warm_seconds, 3), "stt_warm_text": warm_text,
                "stt_warm_rtf": round(warm_seconds / (len(samples) / 16000), 3),
                "llm_seconds": round(llm_seconds, 3), "llm_text": reply,
            },
            "stages": stages,
        }
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
        print(f"report: {args.output}")
        for stage in stages:
            peak = stage["peak"]
            print(
                f"{stage['stage']:<33} RAM {stage['ram_used_mb']:>5} MB "
                f"(peak {peak.get('ram_used_mb', 0):>5})  swap {stage['swap_used_mb']:>4} MB  "
                f"llama {stage['llama_rss_mb']:>4} MB  test {stage['benchmark_rss_mb']:>4} MB"
            )
        audio_seconds = len(samples) / 16000
        print(
            f"STT cold/warm: {cold_seconds:.3f}s / {warm_seconds:.3f}s "
            f"(RTF {cold_seconds / audio_seconds:.3f} / {warm_seconds / audio_seconds:.3f}); "
            f"LLM: {llm_seconds:.3f}s"
        )
    except Exception as error:
        stages.append(monitor.checkpoint("failed"))
        args.output.write_text(json.dumps({
            "error": f"{type(error).__name__}: {error}",
            "models": {"gemma": str(args.gemma), "sensevoice": str(model)},
            "stages": stages,
            "llama_log": str(log_path),
        }, ensure_ascii=False, indent=2) + "\n")
        print(f"failed report: {args.output}", file=sys.stderr)
        raise
    finally:
        monitor.close()
        terminate(llama)
        log.close()


if __name__ == "__main__":
    main()
