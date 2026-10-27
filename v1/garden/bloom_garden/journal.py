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
