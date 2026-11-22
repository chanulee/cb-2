#!/usr/bin/env python3
"""Flash the Bloom Pond (Waveshare ESP32-S3 Touch AMOLED 1.75) over USB-C.

This is only needed once. Later versions arrive over Wi-Fi from Garden.

It writes the complete firmware image and, unless told not to, the Wi-Fi name and
password, so the Pond is online the moment it restarts. Run it with the Python of the
environment the installer made:

    ~/.local/share/bloom/venv/bin/python flash_pond.py

Needs the packages `esptool` and `esp-idf-nvs-partition-gen`.
"""

from __future__ import annotations

import argparse
import csv
import getpass
import glob
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.request import Request, urlopen

REPO = os.environ.get("BLOOM_GITHUB_REPO", "chanulee/cb-2")
FACTORY_ASSET = "bloom-pond-factory.bin"
DATA = Path(os.environ.get("BLOOM_DATA_DIR", "~/.local/share/bloom")).expanduser()
LOCAL_BUILD = Path(__file__).resolve().parents[1] / "pond/firmware/build" / FACTORY_ASSET
NVS_OFFSET = "0x9000"       # must match pond/firmware/partitions.csv
NVS_SIZE = "0x6000"


def find_port() -> str | None:
    by_id = sorted(glob.glob("/dev/serial/by-id/*Espressif*"))
    ports = by_id or sorted(glob.glob("/dev/ttyACM*") + glob.glob("/dev/ttyUSB*"))
    return ports[0] if ports else None


def wait_for_port(seconds: int = 60) -> str | None:
    print("Waiting for the Pond on USB", end="", flush=True)
    deadline = time.time() + seconds
    while time.time() < deadline:
        port = find_port()
        if port:
            print(f"\nFound it at {port}")
            return port
        print(".", end="", flush=True)
        time.sleep(1)
    print()
    return None


def factory_image(explicit: str | None) -> Path:
    """--factory, else a local ESP-IDF build, else the newest GitHub release."""
    if explicit:
        return Path(explicit).expanduser()
    if LOCAL_BUILD.is_file():
        print(f"Using your local build: {LOCAL_BUILD}")
        return LOCAL_BUILD
    target = DATA / "firmware" / FACTORY_ASSET
    url = f"https://github.com/{REPO}/releases/latest/download/{FACTORY_ASSET}"
    print(f"Downloading {url}")
    target.parent.mkdir(parents=True, exist_ok=True)
    with urlopen(Request(url, headers={"User-Agent": "bloom-flash"}), timeout=120) as response:
        target.write_bytes(response.read())
    return target


def current_wifi() -> tuple[str, str]:
    """Wi-Fi this computer is on, and its saved password when NetworkManager gives it."""
    try:
        active = subprocess.run(
            ["nmcli", "-t", "-f", "ACTIVE,SSID", "device", "wifi"],
            capture_output=True, text=True, timeout=10, check=False,
        ).stdout
        ssid = next((line[4:] for line in active.splitlines() if line.startswith("yes:")), "")
        if not ssid:
            return "", ""
        password = subprocess.run(
            ["nmcli", "-s", "-g", "802-11-wireless-security.psk", "connection", "show", ssid],
            capture_output=True, text=True, timeout=10, check=False,
        ).stdout.strip()
        return ssid, password
    except (OSError, subprocess.SubprocessError):
        return "", ""


def ask_wifi(arguments: argparse.Namespace) -> tuple[str, str] | None:
    if arguments.no_wifi:
        return None
    if arguments.ssid:
        return arguments.ssid, arguments.password or ""
    found_ssid, found_password = current_wifi()
    print("\nWi-Fi for the Pond. It must be a 2.4 GHz network; the Pond cannot use 5 GHz.")
    print("Leave the name empty to skip and type it on the Pond's screen instead.")
    ssid = input(f"  Network name [{found_ssid}]: ").strip() or found_ssid
    if not ssid:
        return None
    if ssid == found_ssid and found_password:
        print("  Password: using the one saved on this computer")
        return ssid, found_password
    return ssid, getpass.getpass("  Password: ")


def nvs_image(ssid: str, password: str, directory: Path) -> Path:
    """Build the NVS partition that pond/firmware/main/settings.cpp reads."""
    table, image = directory / "nvs.csv", directory / "nvs.bin"
    with table.open("w", newline="") as file:
        writer = csv.writer(file)
        writer.writerows([
            ["key", "type", "encoding", "value"],
            ["bloom", "namespace", "", ""],
            ["ssid", "data", "string", ssid],
            ["password", "data", "string", password],
        ])
    subprocess.run(
        [sys.executable, "-m", "esp_idf_nvs_partition_gen", "generate", str(table), str(image), NVS_SIZE],
        check=True, stdout=subprocess.DEVNULL,
    )
    return image


def write_flash(port: str, offset: str, image: Path, last: bool) -> None:
    command = [
        sys.executable, "-m", "esptool", "--chip", "esp32s3", "--port", port, "--baud", "460800",
        "--after", "hard-reset" if last else "no-reset", "write-flash", offset, str(image),
    ]
    if not os.access(port, os.R_OK | os.W_OK):
        print(f"No permission for {port}; using sudo. (Fix for good: sudo usermod -aG dialout $USER, then log in again.)")
        command = ["sudo", *command]
    subprocess.run(command, check=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Flash the Bloom Pond over USB-C")
    parser.add_argument("--port", help="serial port, for example /dev/ttyACM0 (default: find it)")
    parser.add_argument("--factory", help=f"path to {FACTORY_ASSET} (default: local build, else latest release)")
    parser.add_argument("--ssid", help="Wi-Fi name to store on the Pond")
    parser.add_argument("--password", help="Wi-Fi password to store on the Pond")
    parser.add_argument("--no-wifi", action="store_true", help="do not store Wi-Fi; set it on the Pond's screen")
    parser.add_argument("--ask", action="store_true", help="ask before starting (used by install.sh)")
    arguments = parser.parse_args()

    if arguments.ask:
        print("\nConnect the Pond to this computer with a USB-C cable.")
        if input("Press Enter to flash it now, or type s and Enter to skip: ").strip().lower().startswith("s"):
            return 0
    port = arguments.port or find_port() or wait_for_port()
    if port is None:
        print("No Pond found. Hold its BOOT button while plugging in the cable, then run this again.")
        return 1
    try:
        image = factory_image(arguments.factory)
        if not image.is_file() or image.stat().st_size < 100_000:
            raise OSError(f"{image} is not a firmware image")
    except OSError as error:
        print(f"Could not get the firmware: {error}")
        print(f"Build it (pond/README.md) or download {FACTORY_ASSET} from the GitHub releases page.")
        return 1

    wifi = ask_wifi(arguments)
    try:
        with tempfile.TemporaryDirectory(prefix="bloom-flash-") as directory:
            nvs = nvs_image(*wifi, Path(directory)) if wifi else None
            print("\nWriting firmware. Do not unplug the Pond.")
            write_flash(port, "0x0", image, last=nvs is None)
            if nvs:
                write_flash(port, NVS_OFFSET, nvs, last=True)
    except subprocess.CalledProcessError as error:
        print(f"\nFlashing failed ({error.returncode}). Hold BOOT while plugging in the cable and try again.")
        return 1
    print("\nDone. The Pond restarts and, with Garden running, shows its first line within a few seconds.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
