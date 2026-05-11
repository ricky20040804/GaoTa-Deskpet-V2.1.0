#!/usr/bin/env python3
"""
Remove bright green screen backgrounds from generated pet videos.

The script writes alpha-preserving QuickTime files next to the source mp4s:
  idle.mp4  -> idle.mov
  run.mp4   -> run.mov
  happy.mp4 -> happy.mov
  rest.mp4  -> rest.mov
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path


DEFAULT_DIR = Path("custompet/generated/current")
DEFAULT_ACTIONS = ["idle", "run", "happy", "rest"]


def run_ffmpeg(source: Path, destination: Path, similarity: float, blend: float) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    filtergraph = (
        f"chromakey=0x00FF00:{similarity}:{blend},"
        "format=yuva444p10le"
    )
    command = [
        "ffmpeg",
        "-y",
        "-i",
        str(source),
        "-vf",
        filtergraph,
        "-an",
        "-c:v",
        "prores_ks",
        "-profile:v",
        "4444",
        "-vendor",
        "apl0",
        "-pix_fmt",
        "yuva444p10le",
        str(destination),
    ]
    print(f"Keying {source} -> {destination}")
    subprocess.run(command, check=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Key out #00FF00 green screen from generated pet videos.")
    parser.add_argument("--dir", type=Path, default=DEFAULT_DIR, help="Directory containing generated action videos.")
    parser.add_argument("--actions", nargs="+", default=DEFAULT_ACTIONS)
    parser.add_argument("--similarity", type=float, default=0.22, help="Chroma key color tolerance.")
    parser.add_argument("--blend", type=float, default=0.04, help="Edge blending amount.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if shutil.which("ffmpeg") is None:
        print("ffmpeg is required but was not found in PATH.", file=sys.stderr)
        return 2

    for action in args.actions:
        source = args.dir / f"{action}.mp4"
        destination = args.dir / f"{action}.mov"
        if not source.exists():
            print(f"Skipping {action}: {source} not found", file=sys.stderr)
            continue
        run_ffmpeg(source, destination, args.similarity, args.blend)

    print(f"Done. Alpha videos written to: {args.dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
