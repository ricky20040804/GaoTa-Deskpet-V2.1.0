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
import zipfile
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

    if DIST_DIR.exists():
        shutil.rmtree(DIST_DIR)

    run(["npm", "run", "pack"], PLAYER_DIR)

    if not DIST_DIR.exists():
        print(f"Build did not create dist directory: {DIST_DIR}", file=sys.stderr)
        return 1

    portable_exes = sorted(
        path
        for path in DIST_DIR.glob("GaoTa-Deskpet-Windows-*.exe")
        if path.is_file()
    )
    if not portable_exes:
        print(f"Build did not create a portable Windows exe in {DIST_DIR}", file=sys.stderr)
        return 1
    portable_exe = portable_exes[-1]

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    if OUTPUT.exists():
        OUTPUT.unlink()

    with zipfile.ZipFile(OUTPUT, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        archive.write(portable_exe, arcname=portable_exe.name)

    print(f"Packaged {portable_exe.name}")
    print(f"Wrote {OUTPUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
