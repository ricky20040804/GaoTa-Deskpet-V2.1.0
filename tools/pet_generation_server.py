#!/usr/bin/env python3
"""
Tiny local/server-side API for the website's "生成宠物资源包" button.

Run:
  export DASHSCOPE_API_KEY="..."
  python3 tools/pet_generation_server.py

Then start the website with:
  REACT_APP_GENERATE_API_URL=http://127.0.0.1:8765/api/generate-pet-package npm start
"""

from __future__ import annotations

import cgi
import os
import shutil
import subprocess
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SUPPORTED_STYLES = {"cartoon-pet", "real-pet", "cartoon-portrait"}


def tail_output(text: str, max_lines: int = 18) -> str:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    return "\n".join(lines[-max_lines:])


def friendly_generation_error(output: str, returncode: int) -> str:
    if "Missing DASHSCOPE_API_KEY" in output:
        return "服务器还没有配置生成 API Key，请稍后再试。"
    if "视频背景检查失败" in output:
        return tail_output(output, 4)
    if "Task" in output and "FAILED" in output:
        return "阿里生成任务失败了。请换一张更清晰、主体完整的照片后重新生成。"
    if "HTTP 400" in output or "InvalidParameter" in output:
        return "生成参数被模型接口拒绝了。请换一张 PNG/JPG 清晰全身照后再试。"
    if "timed out" in output.lower() or "timeout" in output.lower():
        return "生成等待超时了。模型排队可能较久，请稍后重新生成。"

    details = tail_output(output, 6)
    if details:
        return f"生成失败，退出码 {returncode}。\n{details}"
    return f"生成失败，退出码 {returncode}。请稍后重新生成。"


class PetGenerationHandler(BaseHTTPRequestHandler):
    server_version = "GaoTaPetGeneration/1.0"

    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.end_headers()

    def send_plain_error(self, status: int, message: str) -> None:
        data = message.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self) -> None:
        if self.path != "/api/generate-pet-package":
            self.send_plain_error(404, "接口不存在。")
            return

        if not os.environ.get("DASHSCOPE_API_KEY"):
            self.send_plain_error(500, "服务器还没有配置生成 API Key，请稍后再试。")
            return

        work_dir = Path(tempfile.mkdtemp(prefix="gaota-pet-api-"))
        try:
            form = cgi.FieldStorage(
                fp=self.rfile,
                headers=self.headers,
                environ={
                    "REQUEST_METHOD": "POST",
                    "CONTENT_TYPE": self.headers.get("Content-Type", ""),
                },
            )
            photo = form["photo"] if "photo" in form else None
            if photo is None or not getattr(photo, "filename", ""):
                self.send_plain_error(400, "请先上传一张宠物照片。")
                return

            suffix = Path(photo.filename).suffix or ".png"
            photo_path = work_dir / f"upload{suffix}"
            with photo_path.open("wb") as file:
                shutil.copyfileobj(photo.file, file)

            style = form.getfirst("style", "cartoon-pet")
            if style not in SUPPORTED_STYLES:
                self.send_plain_error(400, "这个生成风格暂时不支持，请重新选择。")
                return

            package_dir = work_dir / "custompet"
            zip_path = work_dir / "custompet.zip"
            command = [
                sys.executable,
                str(ROOT / "tools/build_custom_pet_package.py"),
                str(photo_path),
                "--package-dir",
                str(package_dir),
                "--zip-path",
                str(zip_path),
                "--style",
                style,
            ]
            if os.environ.get("GAOTA_ALPHA_MOV") == "1":
                command.append("--alpha-mov")
            if os.environ.get("GAOTA_HEVC_ALPHA") == "1":
                command.append("--hevc-alpha")
            completed = subprocess.run(
                command,
                cwd=ROOT,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
            )
            if completed.stdout:
                print(completed.stdout, flush=True)
            if completed.returncode != 0:
                self.send_plain_error(500, friendly_generation_error(completed.stdout, completed.returncode))
                return

            data = zip_path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "application/zip")
            self.send_header("Content-Disposition", 'attachment; filename="custompet.zip"')
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except Exception as error:
            self.send_plain_error(500, f"服务器处理生成任务时出错：{error}")
        finally:
            shutil.rmtree(work_dir, ignore_errors=True)


def main() -> int:
    host = os.environ.get("GAOTA_GENERATION_HOST", "127.0.0.1")
    port = int(os.environ.get("GAOTA_GENERATION_PORT", "8765"))
    server = ThreadingHTTPServer((host, port), PetGenerationHandler)
    print(f"Pet generation API listening on http://{host}:{port}/api/generate-pet-package")
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
