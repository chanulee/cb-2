"""Garden configuration: defaults, the user's JSON overrides, and file discovery."""

from __future__ import annotations

import copy
import json
import os
import secrets
import shutil
from pathlib import Path

CONFIG_PATH = Path(os.environ.get("BLOOM_CONFIG", "~/.config/bloom/garden.json")).expanduser()
PACKAGE_DIR = Path(__file__).resolve().parent

DEFAULTS: dict = {
    "host": "0.0.0.0",
    "port": 8765,
    "data_dir": "~/.local/share/bloom",
    "language": "en",
    # Words per minute of the Pond wordstream, and the line it shows before the first turn.
    "wpm": 270,
    "opening": "What is on my mind right now?",
    "history_turns": 6,
    "session_idle_minutes": 20,
    "llm": {
        "url": "http://127.0.0.1:8080",
        "server_bin": "",
        "model": "",
        "ctx_size": 2048,
        "temperature": 0.7,
        "max_tokens": 160,
        "extra_args": [],
    },
    "stt": {
        "url": "http://127.0.0.1:8081",
        "server_bin": "",
        "model": "",
        "extra_args": [],
    },
    "firmware": {
        # false: a Pond updates when Garden pushes ("Update Ponds now", publish.sh).
        # true: a Pond also installs a different build by itself at its next check-in.
        "auto_install": False,
        "github_repo": "chanulee/cb-2",
    },
    "upload_token": "",
}

PREFERRED_LLM_MODELS = ("gemma-4-E2B-it-Q4_K_M.gguf",)
PREFERRED_STT_MODELS = ("ggml-base.en.bin", "ggml-small.en.bin", "ggml-base.bin", "ggml-small.bin")


def merge(base: dict, override: dict) -> dict:
    """Recursive dict merge; unknown keys in the override are kept."""
    result = copy.deepcopy(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = merge(result[key], value)
        else:
            result[key] = value
    return result


def load(path: Path = CONFIG_PATH) -> dict:
    """Read the config, creating it with an upload token on first run."""
    stored: dict = {}
    if path.is_file():
        stored = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(stored, dict):
            raise ValueError(f"{path} must contain a JSON object")
    if not stored.get("upload_token"):
        stored["upload_token"] = secrets.token_urlsafe(18)
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(stored, indent=2) + "\n", encoding="utf-8")
            path.chmod(0o600)
        except OSError:
            pass  # read-only home: the token then lives for this run only
    return merge(DEFAULTS, stored)


def data_dir(config: dict) -> Path:
    return Path(config["data_dir"]).expanduser()


def search_roots(config: dict) -> list[Path]:
    """Places where the installer, or the earlier g4q4 setup, put builds and models."""
    roots = [data_dir(config)]
    if os.environ.get("BLOOM_SCRATCH_DIR"):
        roots.append(Path(os.environ["BLOOM_SCRATCH_DIR"]).expanduser())
    roots.append(Path("~/.gemini/antigravity/scratch").expanduser())
    return roots


def _first_file(candidates) -> Path | None:
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return Path(candidate)
    return None


def _pick_model(directories: list[Path], pattern: str, preferred: tuple[str, ...]) -> Path | None:
    found: list[Path] = []
    for directory in directories:
        if directory.is_dir():
            found += sorted(p for p in directory.glob(pattern) if "mmproj" not in p.name and "for-tests" not in p.name)
    for name in preferred:
        for path in found:
            if path.name == name:
                return path
    return found[0] if found else None


def find_llm(config: dict) -> tuple[Path | None, Path | None]:
    """(llama-server binary, GGUF model), each None when not installed."""
    roots = search_roots(config)
    binary = _first_file(
        [config["llm"]["server_bin"]]
        + [root / "llama.cpp/build/bin/llama-server" for root in roots]
        + [shutil.which("llama-server")]
    )
    model = _first_file([config["llm"]["model"]]) or _pick_model(
        [root / "models" for root in roots], "*.gguf", PREFERRED_LLM_MODELS
    )
    return binary, model


def find_stt(config: dict) -> tuple[Path | None, Path | None]:
    """(whisper-server binary, ggml model), each None when not installed."""
    roots = search_roots(config)
    binary = _first_file(
        [config["stt"]["server_bin"]]
        + [root / "whisper.cpp/build/bin/whisper-server" for root in roots]
        + [shutil.which("whisper-server")]
    )
    model = _first_file([config["stt"]["model"]]) or _pick_model(
        [root / "whisper.cpp/models" for root in roots] + [root / "models" for root in roots],
        "ggml-*.bin",
        PREFERRED_STT_MODELS,
    )
    return binary, model


def system_prompt() -> str:
    """The user's prompt file wins over the packaged default."""
    custom = CONFIG_PATH.parent / "system_prompt.txt"
    source = custom if custom.is_file() else PACKAGE_DIR / "system_prompt.txt"
    return source.read_text(encoding="utf-8").strip()
