#!/usr/bin/env python3
"""
Generate GaoTa Deskpet videos with Alibaba Model Studio / DashScope.

Usage:
  export DASHSCOPE_API_KEY="..."
  python3 tools/generate_pet_videos.py /path/to/pet-photo.jpg
"""

from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


DASHSCOPE_API = "https://dashscope.aliyuncs.com/api/v1/services/aigc"
DEFAULT_OUTPUT_DIR = Path("custompet/generated/current")

FIRST_FRAME_PROMPT = (
    "将用户上传的真实宠物照片转换成正面视角的2D卡通桌面宠物首帧。"
    "要求：完整身体，面向镜头，表情友好，背景必须是纯亮绿色绿幕（#00FF00），边缘清晰，"
    "可爱但保留原宠物的毛色、花纹、耳朵、眼睛和体型特征，适合做macOS桌面宠物动画。"
)

ACTION_PROMPTS = {
    "idle": (
        "3秒循环动画。宠物正面站在原地，轻微呼吸，尾巴自然摇动，身体位置基本不移动，"
        "保持2D卡通桌面宠物风格。背景必须是纯亮绿色绿幕（#00FF00），不要有阴影、渐变、纹理或其他物体，动作柔和。"
    ),
    "run": (
        "3秒循环动画。宠物从左向右开心奔跑，步伐清楚，身体轻微弹跳，尾巴跟随摆动，"
        "保持同一只宠物的2D卡通风格。只生成向右奔跑，向左移动将由app镜像。背景必须是纯亮绿色绿幕（#00FF00），不要有阴影、渐变、纹理或其他物体。"
    ),
    "happy": (
        "3秒动画。宠物开心庆祝，原地跳一下或兴奋摇尾巴，表情快乐，像刚刚成功完成任务，"
        "保持2D卡通桌面宠物风格，主体不要离开画面。背景必须是纯亮绿色绿幕（#00FF00），不要有阴影、渐变、纹理或其他物体。"
    ),
    "rest": (
        "3秒循环动画。宠物舒服地趴着或坐趴待机，轻微呼吸，偶尔眨眼或轻轻摇尾巴，"
        "整体安静放松，保持2D卡通桌面宠物风格。背景必须是纯亮绿色绿幕（#00FF00），不要有阴影、渐变、纹理或其他物体。"
    ),
}


def request_json(url: str, api_key: str, payload: dict[str, Any], timeout: int = 60) -> dict[str, Any]:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "X-DashScope-Async": "enable",
        },
        method="POST",
    )
    return open_json(req, timeout=timeout)


def get_json(url: str, api_key: str, timeout: int = 60) -> dict[str, Any]:
    req = urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {api_key}"},
        method="GET",
    )
    return open_json(req, timeout=timeout)


def open_json(req: urllib.request.Request, timeout: int = 60) -> dict[str, Any]:
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code}: {body}") from exc


def image_to_data_url(path: Path) -> str:
    if not path.exists():
        raise FileNotFoundError(path)
    mime_type = mimetypes.guess_type(path.name)[0] or "image/jpeg"
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


def first_task_id(response: dict[str, Any]) -> str:
    task_id = response.get("output", {}).get("task_id") or response.get("task_id")
    if not isinstance(task_id, str) or not task_id:
        raise RuntimeError(f"No task_id in response:\n{json.dumps(response, ensure_ascii=False, indent=2)}")
    return task_id


def poll_task(task_id: str, api_key: str, interval: float = 5.0, timeout: float = 1800.0) -> dict[str, Any]:
    task_url = f"https://dashscope.aliyuncs.com/api/v1/tasks/{urllib.parse.quote(task_id)}"
    started = time.monotonic()

    while True:
        response = get_json(task_url, api_key)
        output = response.get("output", {})
        status = output.get("task_status") or response.get("task_status")
        print(f"  task {task_id}: {status or 'UNKNOWN'}")

        if status == "SUCCEEDED":
            return response
        if status in {"FAILED", "CANCELED", "UNKNOWN"}:
            raise RuntimeError(f"Task {task_id} ended as {status}:\n{json.dumps(response, ensure_ascii=False, indent=2)}")
        if time.monotonic() - started > timeout:
            raise TimeoutError(f"Task {task_id} did not finish within {timeout:.0f}s")
        time.sleep(interval)


def find_urls(value: Any) -> list[str]:
    urls: list[str] = []
    if isinstance(value, str) and value.startswith(("http://", "https://")):
        urls.append(value)
    elif isinstance(value, dict):
        for child in value.values():
            urls.extend(find_urls(child))
    elif isinstance(value, list):
        for child in value:
            urls.extend(find_urls(child))
    return urls


def choose_image_url(response: dict[str, Any]) -> str:
    urls = find_urls(response)
    image_urls = [
        url
        for url in urls
        if any(ext in urllib.parse.urlparse(url).path.lower() for ext in [".png", ".jpg", ".jpeg", ".webp"])
    ]
    if image_urls:
        return image_urls[0]
    if urls:
        return urls[0]
    raise RuntimeError(f"No image URL found:\n{json.dumps(response, ensure_ascii=False, indent=2)}")


def choose_video_url(response: dict[str, Any]) -> str:
    urls = find_urls(response)
    mp4_urls = [url for url in urls if ".mp4" in urllib.parse.urlparse(url).path.lower()]
    if mp4_urls:
        return mp4_urls[0]
    if urls:
        return urls[0]
    raise RuntimeError(f"No video URL found:\n{json.dumps(response, ensure_ascii=False, indent=2)}")


def create_first_frame(api_key: str, source_image: str, model: str) -> str:
    payload = {
        "model": model,
        "input": {
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"text": FIRST_FRAME_PROMPT},
                        {"image": source_image},
                    ],
                }
            ],
        },
        "parameters": {
            "prompt_extend": True,
            "watermark": False,
            "n": 1,
            "enable_interleave": False,
            "size": "1K",
        },
    }
    print(f"Submitting first-frame task with {model}...")
    response = request_json(f"{DASHSCOPE_API}/image-generation/generation", api_key, payload)
    result = poll_task(first_task_id(response), api_key)
    image_url = choose_image_url(result)
    print(f"First frame: {image_url}")
    return image_url


def create_video(api_key: str, first_frame_url: str, action: str, model: str) -> str:
    payload = {
        "model": model,
        "input": {
            "prompt": ACTION_PROMPTS[action],
            "img_url": first_frame_url,
        },
        "parameters": {
            "duration": 3,
            "resolution": "720P",
            "audio": False,
            "watermark": False,
        },
    }
    print(f"Submitting {action} video task with {model}...")
    response = request_json(f"{DASHSCOPE_API}/video-generation/video-synthesis", api_key, payload)
    result = poll_task(first_task_id(response), api_key)
    video_url = choose_video_url(result)
    print(f"{action}: {video_url}")
    return video_url


def download(url: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {destination.name}...")
    with urllib.request.urlopen(url, timeout=300) as response:
        destination.write_bytes(response.read())


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate Deskpet first frame and action videos.")
    parser.add_argument("photo", nargs="?", help="Local pet photo path. Optional when --first-frame-url is provided.")
    parser.add_argument("--first-frame-url", help="Use an existing first-frame image URL and skip wan2.6-image.")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--image-model", default="wan2.6-image")
    parser.add_argument("--video-model", default="wan2.6-i2v-flash")
    parser.add_argument("--actions", nargs="+", choices=sorted(ACTION_PROMPTS), default=list(ACTION_PROMPTS))
    parser.add_argument("--save-first-frame-url", type=Path, default=None)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    api_key = os.environ.get("DASHSCOPE_API_KEY")
    if not api_key:
        print("Missing DASHSCOPE_API_KEY environment variable.", file=sys.stderr)
        return 2

    if args.first_frame_url:
        first_frame_url = args.first_frame_url
    else:
        if not args.photo:
            print("Provide a local photo path or --first-frame-url.", file=sys.stderr)
            return 2
        first_frame_url = create_first_frame(api_key, image_to_data_url(Path(args.photo)), args.image_model)

    if args.save_first_frame_url:
        args.save_first_frame_url.parent.mkdir(parents=True, exist_ok=True)
        args.save_first_frame_url.write_text(first_frame_url + "\n", encoding="utf-8")

    for action in args.actions:
        video_url = create_video(api_key, first_frame_url, action, args.video_model)
        download(video_url, args.output_dir / f"{action}.mp4")

    print(f"Done. Videos written to: {args.output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
