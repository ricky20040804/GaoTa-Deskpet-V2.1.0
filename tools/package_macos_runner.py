#!/usr/bin/env python3
"""
Build and zip the macOS desktop pet runner for the website download button.

Output:
  website/public/downloads/gaotadeskpet.zip
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "website/public/downloads/gaotadeskpet.zip"
APP_NAME = "GaoTa Deskpet.app"


def run(command: list[str]) -> None:
    print("+ " + " ".join(command))
    subprocess.run(command, cwd=ROOT, check=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build and zip the macOS runner app.")
    parser.add_argument("--configuration", default="Release", choices=["Debug", "Release"])
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    build_dir = ROOT / "build/macos-runner"
    output = args.output.expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)

    if build_dir.exists():
        shutil.rmtree(build_dir)
    build_dir.mkdir(parents=True, exist_ok=True)

    run([
        "xcodebuild",
        "-project",
        "lil-agents.xcodeproj",
        "-scheme",
        "LilAgents",
        "-configuration",
        args.configuration,
        "-derivedDataPath",
        str(build_dir / "DerivedData"),
        "build",
    ])

    app_path = build_dir / f"DerivedData/Build/Products/{args.configuration}/{APP_NAME}"
    if not app_path.exists():
        raise FileNotFoundError(app_path)

    if output.exists():
        output.unlink()

    run([
        "ditto",
        "-c",
        "-k",
        "--sequesterRsrc",
        "--keepParent",
        str(app_path),
        str(output),
    ])

    print(f"Done. macOS runner zip: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
