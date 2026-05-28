#!/usr/bin/env python3
"""Package the lightweight Tauri Windows desktop pet runner for website downloads.

Run from the repo root:
  python3 tools/package_windows_runner.py

The script builds the Tauri/WebView2 Windows player and writes:
  website/public/downloads/gaotadeskpet-windows.zip

Run this on Windows so Tauri can produce the native .exe.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PLAYER_DIR = ROOT / "windows-tauri-player"
RELEASE_DIR = PLAYER_DIR / "src-tauri" / "target" / "release"
OUTPUT = ROOT / "website/public/downloads/gaotadeskpet-windows.zip"


def run(command: list[str], cwd: Path) -> None:
    print("+", " ".join(command))
    subprocess.run(command, cwd=cwd, check=True)


def main() -> int:
    if not PLAYER_DIR.exists():
        print(f"Missing Windows player directory: {PLAYER_DIR}", file=sys.stderr)
        return 1

    if RELEASE_DIR.exists():
        shutil.rmtree(RELEASE_DIR)

    run(["cargo", "build", "--release", "--manifest-path", str(PLAYER_DIR / "src-tauri/Cargo.toml")], ROOT)

    if not RELEASE_DIR.exists():
        print(f"Build did not create release directory: {RELEASE_DIR}", file=sys.stderr)
        return 1

    runner_exes = sorted(
        path
        for path in RELEASE_DIR.glob("*.exe")
        if path.is_file()
    )
    if not runner_exes:
        print(f"Build did not create a Tauri Windows exe in {RELEASE_DIR}", file=sys.stderr)
        return 1
    runner_exe = runner_exes[-1]

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    if OUTPUT.exists():
        OUTPUT.unlink()

    with zipfile.ZipFile(OUTPUT, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        archive.write(runner_exe, arcname="GaoTa-Deskpet-Windows.exe")

    print(f"Packaged {runner_exe.name}")
    print(f"Wrote {OUTPUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
