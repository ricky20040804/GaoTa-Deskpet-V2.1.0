#!/usr/bin/env python3
"""
Build a downloadable custompet.zip for the website generator.

Pipeline:
  1. Generate first frame and four green-background mp4 actions.
  2. Zip the custompet folder so Downloads/custompet is ready for the app.

The macOS runner keys the bright green background in real time, so the website
package keeps the original mp4 files. Alpha mov generation is still available as
an explicit compatibility mode for local testing.
"""

from __future__ import annotations

import argparse
import json
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


def probe_video_size(video_path: Path) -> tuple[int, int]:
    output = subprocess.check_output(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height",
            "-of",
            "json",
            str(video_path),
        ],
        cwd=ROOT,
        text=True,
    )
    streams = json.loads(output).get("streams", [])
    if not streams:
        raise RuntimeError(f"Cannot inspect generated video: {video_path.name}")

    return int(streams[0]["width"]), int(streams[0]["height"])


def sample_average_rgb(video_path: Path, timestamp: float, crop: tuple[int, int, int, int]) -> tuple[int, int, int]:
    x, y, width, height = crop
    output = subprocess.check_output(
        [
            "ffmpeg",
            "-v",
            "error",
            "-ss",
            f"{timestamp:.2f}",
            "-i",
            str(video_path),
            "-frames:v",
            "1",
            "-vf",
            f"crop={width}:{height}:{x}:{y},scale=1:1,format=rgb24",
            "-f",
            "rawvideo",
            "-",
        ],
        cwd=ROOT,
    )
    if len(output) < 3:
        raise RuntimeError(f"Cannot sample generated video background: {video_path.name}")

    return output[0], output[1], output[2]


def validate_green_background(package_dir: Path, actions: list[str]) -> None:
    print("Checking generated mp4 green backgrounds...", flush=True)
    timestamps = [0.2, 1.5, 2.8]
    max_failed_samples = 2

    for action in actions:
        video_path = package_dir / f"{action}.mp4"
        if not video_path.exists():
            raise RuntimeError(f"Missing generated video: {video_path.name}")

        video_width, video_height = probe_video_size(video_path)
        sample_size = max(24, min(80, video_width // 12, video_height // 12))
        crops = [
            ("左上角", (0, 0, sample_size, sample_size)),
            ("右上角", (video_width - sample_size, 0, sample_size, sample_size)),
            ("左下角", (0, video_height - sample_size, sample_size, sample_size)),
            ("右下角", (video_width - sample_size, video_height - sample_size, sample_size, sample_size)),
        ]
        failed_samples: list[str] = []

        for timestamp in timestamps:
            for corner_name, crop in crops:
                red, green, blue = sample_average_rgb(video_path, timestamp, crop)
                is_bright_green = green >= 155 and green - red >= 70 and green - blue >= 65
                if not is_bright_green:
                    failed_samples.append(f"{timestamp:.1f}s {corner_name} RGB {red},{green},{blue}")

        if len(failed_samples) > max_failed_samples:
            sample_details = "；".join(failed_samples[:4])
            raise RuntimeError(
                "视频背景检查失败："
                f"{video_path.name} 有 {len(failed_samples)}/{len(timestamps) * len(crops)} 个采样点不是稳定亮绿色。"
                f"{sample_details}。请重新生成，或换一张主体更清晰、背景更简单的照片。"
            )

        if failed_samples:
            print(
                f"Warning: {video_path.name} has {len(failed_samples)} minor green-screen sample warning(s), accepted.",
                flush=True,
            )


def create_windows_alpha_webms(package_dir: Path, actions: list[str], similarity: float, blend: float) -> None:
    print("Creating Windows alpha WebM videos...", flush=True)
    for action in actions:
        source = package_dir / f"{action}.mp4"
        destination = package_dir / f"{action}.webm"
        if not source.exists():
            raise RuntimeError(f"Missing generated video for Windows WebM: {source.name}")

        filtergraph = (
            f"chromakey=0x00FF00:{similarity}:{blend},"
            "format=yuva420p"
        )
        run(
            [
                "ffmpeg",
                "-y",
                "-i",
                str(source),
                "-vf",
                filtergraph,
                "-an",
                "-c:v",
                "libvpx-vp9",
                "-b:v",
                "0",
                "-crf",
                "32",
                "-auto-alt-ref",
                "0",
                "-pix_fmt",
                "yuva420p",
                str(destination),
            ]
        )


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
    parser.add_argument("--alpha-mov", action="store_true", help="Also create alpha mov files for compatibility testing.")
    parser.add_argument("--hevc-alpha", action="store_true", help="Convert alpha mov files to HEVC with Alpha and package those instead of mp4.")
    parser.add_argument("--include-windows-main-js", action="store_true", help="Include only windows-player/src/main.js in the generated package.")
    parser.add_argument("--skip-hevc", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--skip-background-check", action="store_true", help="Skip green background validation.")
    parser.add_argument("--similarity", type=float, default=0.22)
    parser.add_argument("--blend", type=float, default=0.04)
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    if not os.environ.get("DASHSCOPE_API_KEY"):
        print("Missing DASHSCOPE_API_KEY environment variable.", file=sys.stderr)
        return 2

    if args.skip_hevc:
        args.alpha_mov = True
        args.hevc_alpha = False

    if not args.skip_background_check or args.alpha_mov or args.hevc_alpha:
        require_tool("ffmpeg")
        require_tool("ffprobe")
    if args.hevc_alpha:
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

    if not args.skip_background_check:
        validate_green_background(package_dir, args.actions)

    create_windows_alpha_webms(package_dir, args.actions, args.similarity, args.blend)

    if args.alpha_mov or args.hevc_alpha:
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

    if args.hevc_alpha:
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

    if args.include_windows_main_js:
        source_main_js = ROOT / "windows-player/src/main.js"
        if not source_main_js.exists():
            raise RuntimeError("Cannot include Windows source file: windows-player/src/main.js was not found")
        shutil.copy2(source_main_js, package_dir / "main.js")

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
