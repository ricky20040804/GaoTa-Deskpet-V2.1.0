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
FRAME_SAFETY_RULE = (
    "画面构图必须全程保留完整主体，头部、耳朵、尾巴、四肢和身体任何部分都不能超出画面或贴边，"
    "四周至少保留15%的纯绿色安全边距。动作幅度要控制在画面中央区域内，不能被裁剪。"
)
PORTRAIT_FRAME_SAFETY_RULE = (
    "画面构图必须全程保留完整人物主体，头部、头发、手臂、手、腿、脚、服饰和身体任何部分都不能超出画面或贴边，"
    "四周至少保留15%的纯绿色安全边距。动作幅度要控制在画面中央区域内，不能被裁剪。"
)
PORTRAIT_IDENTITY_RULE = (
    "人物相似度是最高优先级：必须尽量像用户上传照片里的同一个人，而不是生成通用帅哥或通用美女。"
    "严格保留原照片人物的脸型轮廓、五官比例、眼睛形状和眼距、眉形、鼻型、嘴型、下巴、发型、发色、刘海或发缝、"
    "肤色、年龄感、表情气质、服饰颜色、服饰款式和可见配饰。"
    "可以卡通化和可爱化，但不要过度美颜，不要改变性别、年龄感、发型、服装、脸部特征或整体气质。"
)
GREEN_SCREEN_RULE = (
    "背景必须在所有帧中始终保持完全一致的纯亮绿色绿幕（#00FF00），"
    "不能出现颜色变化、光照变化、阴影、渐变、纹理、噪点、物体、地面线或透明边缘污染，方便后续脚本稳定抠图。"
)

STYLE_PROMPTS = {
    "cartoon-pet": (
        "将用户上传的真实宠物照片转换成正面视角的2D卡通桌面宠物首帧。"
        "要求：完整身体，面向镜头，表情友好，边缘清晰，"
        "可爱但保留原宠物的毛色、花纹、耳朵、眼睛和体型特征，适合做macOS桌面宠物动画。"
        f"{FRAME_SAFETY_RULE}{GREEN_SCREEN_RULE}"
    ),
    "real-pet": (
        "根据用户上传的真实宠物照片生成正面视角的真实版桌面宠物首帧。"
        "要求：完整身体，面向镜头，姿态自然，外观尽量与照片里的宠物一模一样，"
        "严格保留原宠物的毛色、花纹、斑点、耳朵形状、眼睛、鼻子、嘴部、尾巴、体型比例和整体神态。"
        "不要生成卡通风、插画风、拟人风、玩偶风或贴纸风，不要改变品种和身体结构。"
        "边缘清晰，适合做macOS桌面宠物动画。"
        f"{FRAME_SAFETY_RULE}{GREEN_SCREEN_RULE}"
    ),
    "cartoon-portrait": (
        "将用户上传的照片转换成正面视角的2D卡通桌面伙伴首帧。"
        "先根据照片判断主体是男性还是女性，并按判断结果生成对应性别的卡通人像："
        "如果是男性，生成可爱的男性2D卡通桌面伙伴；如果是女性，生成可爱的女性2D卡通桌面伙伴。"
        f"{PORTRAIT_IDENTITY_RULE}"
        "要求：全身完整站立，正面或轻微三分之二正面视角，面向镜头，表情友好，边缘清晰，"
        "适合做桌面宠物动画。"
        "不要改变用户照片主体的性别，不要生成多人，不要生成宠物、动物或玩偶。"
        f"{PORTRAIT_FRAME_SAFETY_RULE}{GREEN_SCREEN_RULE}"
    ),
}

ACTION_STYLE_PHRASES = {
    "cartoon-pet": "保持2D卡通桌面宠物风格，保留同一只宠物的毛色、花纹和体型特征。",
    "real-pet": (
        "保持真实版宠物外观，尽量与首帧和原照片中的宠物一模一样，"
        "不要变成卡通、插画、玩偶或拟人风，保留毛色、花纹、五官、耳朵、尾巴和体型比例。"
    ),
    "cartoon-portrait": (
        "保持2D卡通桌面伙伴风格，并且必须像首帧和原照片里的同一个人。"
        f"{PORTRAIT_IDENTITY_RULE}"
        "四个动作之间脸型、五官比例、发型、发色、服饰、配饰和整体气质必须保持一致。"
    ),
}

FIRST_FRAME_PROMPT = STYLE_PROMPTS["cartoon-pet"]

ACTION_PROMPT_TEMPLATES = {
    "idle": (
        "3秒循环动画。宠物正面站在原地，轻微呼吸，尾巴自然摇动，身体位置基本不移动，"
        "{style_phrase}动作柔和。"
        f"{FRAME_SAFETY_RULE}{GREEN_SCREEN_RULE}"
    ),
    "run": (
        "3秒循环动画。宠物从左向右开心奔跑，步伐清楚，身体轻微弹跳，尾巴跟随摆动，"
        "{style_phrase}只生成向右奔跑，向左移动将由app镜像。"
        f"{FRAME_SAFETY_RULE}{GREEN_SCREEN_RULE}"
        "奔跑时宠物整体可以做原地跑步动作，但不要让身体横向跑出画面。"
    ),
    "happy": (
        "3秒动画。宠物开心庆祝，原地跳一下或兴奋摇尾巴，表情快乐，像刚刚成功完成任务，"
        "{style_phrase}主体不要离开画面。"
        f"{FRAME_SAFETY_RULE}{GREEN_SCREEN_RULE}"
        "开心跳跃时高度要小，头顶和耳朵不能接近或超出画面顶部。"
    ),
    "rest": (
        "3秒循环动画。宠物舒服地趴着或坐趴待机，轻微呼吸，偶尔眨眼或轻轻摇尾巴，"
        "整体安静放松，{style_phrase}"
        f"{FRAME_SAFETY_RULE}{GREEN_SCREEN_RULE}"
    ),
}

PORTRAIT_ACTION_PROMPT_TEMPLATES = {
    "idle": (
        "3秒循环动画。卡通人像全身完整站着待机，姿态自然放松，轻微呼吸，偶尔眨眼，"
        "手臂和头发有很轻微的自然摆动，身体位置基本不移动。"
        "{style_phrase}根据首帧主体的性别保持一致：男性保持男性外貌和气质，女性保持女性外貌和气质。"
        f"{PORTRAIT_FRAME_SAFETY_RULE}{GREEN_SCREEN_RULE}"
    ),
    "run": (
        "3秒循环动画。卡通人像从右向左轻松溜达/散步，步伐自然，身体轻微上下起伏，"
        "手臂随步伐轻轻摆动，表情轻松。"
        "{style_phrase}根据首帧主体的性别保持一致：男性保持男性外貌和气质，女性保持女性外貌和气质。"
        "只生成向左溜达，不要生成向右溜达。"
        f"{PORTRAIT_FRAME_SAFETY_RULE}{GREEN_SCREEN_RULE}"
        "溜达时主体可以做原地走路动作，但不要让身体横向走出画面。"
    ),
    "happy": (
        "3秒动画。先根据首帧主体的性别保持一致："
        "如果是女性，角色站立，身体重心落在一条腿上，另一条腿微微抬起并向前或侧边弯曲，"
        "整体姿势自然不要夸张；一只手举到脸旁边做 V 字手势，也就是比耶；"
        "另一只手可以自然放在身体旁边或轻轻摆出平衡姿势；"
        "表情要活泼可爱，一只眼睛闭上做 wink，另一只眼睛睁开看向前方，嘴巴微笑。"
        "如果是男性，卡通人像开心庆祝，原地轻轻跳一下、挥手或比一个开心的手势，"
        "表情快乐，像刚刚成功完成任务。"
        "{style_phrase}男性保持男性外貌和气质，女性保持女性外貌和气质。"
        f"{PORTRAIT_FRAME_SAFETY_RULE}{GREEN_SCREEN_RULE}"
        "开心动作幅度要小，头顶、手臂、头发和脚都不能接近或超出画面边缘。"
    ),
    "rest": (
        "3秒循环动画。卡通人像从旁边搬来一把简洁的小椅子，坐上去，最后形成坐着跷二郎腿的待机姿势，"
        "动作自然可爱，坐稳后轻微呼吸、偶尔眨眼，表情放松。椅子必须完整出现在画面中，但不要喧宾夺主。"
        "{style_phrase}根据首帧主体的性别保持一致：男性保持男性外貌和气质，女性保持女性外貌和气质。"
        f"{PORTRAIT_FRAME_SAFETY_RULE}{GREEN_SCREEN_RULE}"
        "搬椅子和坐下时身体、椅子、腿、脚、手臂、头发都不能超出画面。"
    ),
}

ACTION_PROMPTS = {
    action: template.format(style_phrase=ACTION_STYLE_PHRASES["cartoon-pet"])
    for action, template in ACTION_PROMPT_TEMPLATES.items()
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


def action_prompt(action: str, style: str) -> str:
    style_phrase = ACTION_STYLE_PHRASES.get(style, ACTION_STYLE_PHRASES["cartoon-pet"])
    templates = PORTRAIT_ACTION_PROMPT_TEMPLATES if style == "cartoon-portrait" else ACTION_PROMPT_TEMPLATES
    return templates[action].format(style_phrase=style_phrase)


def create_first_frame(api_key: str, source_image: str, model: str, style: str) -> str:
    payload = {
        "model": model,
        "input": {
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"text": STYLE_PROMPTS.get(style, FIRST_FRAME_PROMPT)},
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


def create_video(api_key: str, first_frame_url: str, action: str, model: str, style: str) -> str:
    payload = {
        "model": model,
        "input": {
            "prompt": action_prompt(action, style),
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
    parser.add_argument("--style", choices=sorted(STYLE_PROMPTS), default="cartoon-pet")
    parser.add_argument("--save-first-frame-url", type=Path, default=None)
    parser.add_argument("--save-first-frame", type=Path, default=None, help="Download the generated first frame image to this path.")
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
        first_frame_url = create_first_frame(api_key, image_to_data_url(Path(args.photo)), args.image_model, args.style)

    if args.save_first_frame_url:
        args.save_first_frame_url.parent.mkdir(parents=True, exist_ok=True)
        args.save_first_frame_url.write_text(first_frame_url + "\n", encoding="utf-8")

    if args.save_first_frame:
        download(first_frame_url, args.save_first_frame)

    for action in args.actions:
        video_url = create_video(api_key, first_frame_url, action, args.video_model, args.style)
        download(video_url, args.output_dir / f"{action}.mp4")

    print(f"Done. Videos written to: {args.output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
