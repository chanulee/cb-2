"""Day-by-day memory of Pond turns that the Garden display grows from.

Pure functions shape the record; `append` and `load` are the only file effects.
"""

from __future__ import annotations

import json
import os
import re
from collections import Counter
from datetime import date, datetime
from pathlib import Path


STOPWORDS = frozenset(
    """a about after again all also am an and any are as at be because been before
    being but by can could did do does doing done don't for from get got had has
    have having he her here him his how i i'm i've if in into is it it's its just
    know like made make me more most my myself no not now of off on once one only
    or other our out over really she so some still such than that the their them
    then there these they thing things think this those through to today too up
    us very was way we went were what when where which while who why will with
    would you your yourself day time bit lot kind maybe little much feel felt
    want wanted going gonna said say""".split()
)


SYNTHETIC = Path(__file__).resolve().parent.parent / "data" / "synthetic_garden.json"
LEVELS = ("raw", "summary", "gist", "keywords")


def compression(age: int) -> str:
    """Older days are kept at lower fidelity, like a summarised context."""
    return LEVELS[min(max(age, 0), len(LEVELS) - 1)]


def rank_memory(memory: list[dict], today: date) -> list[dict]:
    """Weight = how often it recurs, recent days counting more; strongest first."""
    ranked = []
    for item in memory:
        weight = sum(0.75 ** (today - date.fromisoformat(day)).days for day in item.get("days", []))
        ranked.append({**item, "weight": round(weight, 3)})
    return sorted(ranked, key=lambda item: -item["weight"])


def synthetic(today: date, path: Path = SYNTHETIC) -> dict:
    """Sample garden shifted so its last day is today."""
    data = json.loads(path.read_text(encoding="utf-8"))
    shift = today - date.fromisoformat(data["anchor"])
    moved = lambda key: (date.fromisoformat(key) + shift).isoformat()  # noqa: E731
    days = []
    for day in data["days"]:
        when = date.fromisoformat(day["date"]) + shift
        age = (today - when).days
        days.append({**day, "date": when.isoformat(), "age": age, "compression": compression(age), "turns": len(day["turns"]), "lines": [turn["answer"] for turn in day["turns"]]})
    memory = [{**item, "days": [moved(key) for key in item["days"]]} for item in data["memory"]]
    return {"today": today.isoformat(), "sample": True, "memory": rank_memory(memory, today), "days": days}


def garden(entries: list[dict[str, str]], today: date) -> dict:
    """What the display grows from; falls back to the sample garden when empty."""
    if not entries:
        return synthetic(today)
    grouped = days(entries, today)
    for day in grouped:
        day["compression"] = compression(day["age"])
        day["threads"] = [{"topic": topic, "memory": [topic], "facets": []} for topic in day["topics"]]
    memory: dict[str, list[str]] = {}
    for day in grouped:
        for topic in day["topics"]:
            memory.setdefault(topic, []).append(day["date"])
    recurring = [{"key": key, "label": key, "kind": "theme", "days": dates} for key, dates in memory.items() if len(dates) > 1]
    return {"today": today.isoformat(), "sample": False, "memory": rank_memory(recurring, today), "days": grouped}


def journal_path() -> Path:
    root = os.environ.get("BLOOM_GARDEN_DIR") or os.path.expanduser("~/.bloom")
    return Path(root) / "garden.jsonl"


def entry(transcript: str, prompt: str, when: datetime) -> dict[str, str]:
    return {"at": when.isoformat(timespec="seconds"), "transcript": transcript.strip(), "prompt": prompt.strip()}


def topics(texts: list[str], limit: int = 5) -> list[str]:
    """Most repeated meaningful words; a cheap stand-in until Gemma names topics."""
    words = Counter()
    for text in texts:
        for word in re.findall(r"[a-zA-Z가-힣][a-zA-Z가-힣'-]{2,}", text.lower()):
            if word not in STOPWORDS:
                words[word] += 1
    return [word for word, _ in words.most_common(limit)]


def days(entries: list[dict[str, str]], today: date) -> list[dict[str, object]]:
    """Group entries by date, oldest first, with age used for abstraction color."""
    grouped: dict[str, list[dict[str, str]]] = {}
    for item in entries:
        grouped.setdefault(item["at"][:10], []).append(item)
    result = []
    for key in sorted(grouped):
        items = grouped[key]
        texts = [item["transcript"] for item in items if item.get("transcript")]
        result.append({
            "date": key,
            "age": (today - date.fromisoformat(key)).days,
            "turns": len(items),
            "topics": topics(texts, 5 if key == today.isoformat() else 3),
            "lines": [item["transcript"][:140] for item in items[-6:] if item.get("transcript")],
        })
    return result


def append(item: dict[str, str], path: Path | None = None) -> None:
    path = path or journal_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as file:
        file.write(json.dumps(item, ensure_ascii=False) + "\n")


def load(path: Path | None = None) -> list[dict[str, str]]:
    path = path or journal_path()
    if not path.is_file():
        return []
    result = []
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            item = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(item, dict) and isinstance(item.get("at"), str):
            result.append(item)
    return result
