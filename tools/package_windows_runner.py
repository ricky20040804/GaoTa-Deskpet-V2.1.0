#!/usr/bin/env python3
"""Package the Windows desktop pet runner for website downloads.

Run from the repo root:
  python3 tools/package_windows_runner.py

The script builds the Electron Windows player and writes:
  website/public/downloads/gaotadeskpet-windows.zip

For the most reliable Windows executable, run this on Windows.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PLAYER_DIR = ROOT / "windows-player"
DIST_DIR = PLAYER_DIR / "dist"
OUTPUT = ROOT / "website/public/downloads/gaotadeskpet-windows.zip"


def run(command: list[str], cwd: Path) -> None:
    print("+", " ".join(command))
    subprocess.run(command, cwd=cwd, check=True)


def main() -> int:
    if not PLAYER_DIR.exists():
        print(f"Missing Windows player directory: {PLAYER_DIR}", file=sys.stderr)
        return 1

    if not (PLAYER_DIR / "node_modules").exists():
        run(["npm", "install"], PLAYER_DIR)

    run(["npm", "run", "pack"], PLAYER_DIR)

    if not DIST_DIR.exists():
        print(f"Build did not create dist directory: {DIST_DIR}", file=sys.stderr)
        return 1

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    if OUTPUT.exists():
        OUTPUT.unlink()

    shutil.make_archive(str(OUTPUT.with_suffix("")), "zip", DIST_DIR)
    print(f"Wrote {OUTPUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
