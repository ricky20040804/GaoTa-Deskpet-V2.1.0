#!/usr/bin/env python3
"""
Build a downloadable custompet.zip for the website generator.

Pipeline:
  1. Generate first frame and four green-background mp4 actions.
  2. Key #00FF00 into ProRes 4444 alpha mov files.
  3. Convert those alpha mov files into smaller HEVC with Alpha mov files.
  4. Zip the custompet folder so Downloads/custompet is ready for the app.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ACTIONS = ["idle", "run", "happy", "rest"]


def run(command: list[str]) -> None:
    print("+ " + " ".join(command), flush=True)
    subprocess.run(command, cwd=ROOT, check=True)


def require_tool(name: str) -> None:
    if shutil.which(name) is None:
        raise RuntimeError(f"{name} is required but was not found in PATH")


def zip_directory(source_dir: Path, zip_path: Path) -> None:
    zip_path.parent.mkdir(parents=True, exist_ok=True)
    if zip_path.exists():
        zip_path.unlink()

    archive_base = zip_path.with_suffix("")
    created = shutil.make_archive(
        str(archive_base),
        "zip",
        root_dir=source_dir.parent,
        base_dir=source_dir.name,
    )
    created_path = Path(created)
    if created_path != zip_path:
        if zip_path.exists():
            zip_path.unlink()
        created_path.replace(zip_path)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate and package a custom desktop pet.")
    parser.add_argument("photo", type=Path, help="Uploaded pet photo.")
    parser.add_argument("--package-dir", type=Path, default=Path("custompet"), help="Output custompet directory.")
    parser.add_argument("--zip-path", type=Path, default=Path("custompet.zip"), help="Output zip path.")
    parser.add_argument("--style", choices=["cartoon-pet", "real-pet", "cartoon-portrait"], default="cartoon-pet")
    parser.add_argument("--actions", nargs="+", choices=DEFAULT_ACTIONS, default=DEFAULT_ACTIONS)
    parser.add_argument("--skip-hevc", action="store_true", help="Only create ProRes alpha mov files.")
    parser.add_argument("--similarity", type=float, default=0.22)
    parser.add_argument("--blend", type=float, default=0.04)
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    if not os.environ.get("DASHSCOPE_API_KEY"):
        print("Missing DASHSCOPE_API_KEY environment variable.", file=sys.stderr)
        return 2

    require_tool("ffmpeg")
    if not args.skip_hevc:
        require_tool("swift")

    package_dir = args.package_dir.resolve()
    if package_dir.exists():
        shutil.rmtree(package_dir)
    package_dir.mkdir(parents=True)

    first_frame = package_dir / "first_frame.png"
    first_frame_url = package_dir / "first_frame_url.txt"

    run(
        [
            sys.executable,
            str(ROOT / "tools/generate_pet_videos.py"),
            str(args.photo.resolve()),
            "--output-dir",
            str(package_dir),
            "--style",
            args.style,
            "--actions",
            *args.actions,
            "--save-first-frame",
            str(first_frame),
            "--save-first-frame-url",
            str(first_frame_url),
        ]
    )

    run(
        [
            sys.executable,
            str(ROOT / "tools/key_green_screen.py"),
            "--dir",
            str(package_dir),
            "--actions",
            *args.actions,
            "--similarity",
            str(args.similarity),
            "--blend",
            str(args.blend),
        ]
    )

    if not args.skip_hevc:
        run(
            [
                "swift",
                "-module-cache-path",
                "/private/tmp/swift-module-cache",
                str(ROOT / "tools/convert_hevc_alpha.swift"),
                str(package_dir),
            ]
        )
        for action in args.actions:
            for temporary_video in (package_dir / f"{action}.mov", package_dir / f"{action}.mp4"):
                if temporary_video.exists():
                    temporary_video.unlink()
    else:
        for action in args.actions:
            temporary_mp4 = package_dir / f"{action}.mp4"
            if temporary_mp4.exists():
                temporary_mp4.unlink()

    zip_directory(package_dir, args.zip_path.resolve())
    print(f"Done. Package written to: {args.zip_path.resolve()}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.CalledProcessError as error:
        raise SystemExit(error.returncode)
    except RuntimeError as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2)
