"""The Pond firmware image Garden serves for over-the-air updates."""

from __future__ import annotations

import os
import struct
import tempfile
from pathlib import Path
from urllib.request import Request, urlopen

IMAGE_MAGIC = 0xE9
APP_DESC_MAGIC = 0xABCD5432
APP_DESC_OFFSET = 32          # image header (24) + first segment header (8)
MAX_IMAGE_BYTES = 6 * 1024 * 1024   # size of one OTA slot in partitions.csv
RELEASE_ASSET = "bloom-pond.bin"


def describe(image: bytes) -> dict:
    """Read version and ELF hash from an ESP-IDF application image (esp_app_desc_t)."""
    if len(image) < APP_DESC_OFFSET + 256 or image[0] != IMAGE_MAGIC:
        raise ValueError("not an ESP-IDF application image")
    if len(image) > MAX_IMAGE_BYTES:
        raise ValueError("image is larger than the 6 MB OTA slot")
    magic, _secure, _reserved, version, project, _time, _date, _idf, sha = struct.unpack_from(
        "<II8s32s32s16s16s32s32s", image, APP_DESC_OFFSET
    )
    if magic != APP_DESC_MAGIC:
        raise ValueError("application descriptor is missing; upload build/bloom-pond.bin")

    def text(raw: bytes) -> str:
        return raw.split(b"\0", 1)[0].decode("ascii", "replace")

    return {"version": text(version), "project": text(project), "sha256": sha.hex(), "size": len(image)}


class Store:
    def __init__(self, directory: Path) -> None:
        self.path = directory / "pond.bin"
        self._cache: tuple[float, dict] | None = None

    def info(self) -> dict | None:
        """Descriptor of the stored image, or None when Garden has no firmware."""
        try:
            modified = self.path.stat().st_mtime
        except OSError:
            return None
        if self._cache is None or self._cache[0] != modified:
            try:
                self._cache = (modified, describe(self.path.read_bytes()))
            except ValueError:
                return None
        return dict(self._cache[1])

    def save(self, image: bytes) -> dict:
        info = describe(image)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        handle, temporary = tempfile.mkstemp(dir=self.path.parent, suffix=".part")
        with os.fdopen(handle, "wb") as file:
            file.write(image)
        os.replace(temporary, self.path)
        return info

    def fetch_release(self, repo: str) -> dict:
        """Download the newest released Pond image from GitHub."""
        url = f"https://github.com/{repo}/releases/latest/download/{RELEASE_ASSET}"
        request = Request(url, headers={"User-Agent": "bloom-garden"})
        with urlopen(request, timeout=60) as response:  # noqa: S310 - fixed https URL
            image = response.read(MAX_IMAGE_BYTES + 1)
        return self.save(image)
