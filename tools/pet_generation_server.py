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
import platform
import shutil
import subprocess
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SUPPORTED_STYLES = {"cartoon-pet", "real-pet", "cartoon-portrait"}


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

    def do_POST(self) -> None:
        if self.path != "/api/generate-pet-package":
            self.send_error(404, "Not found")
            return

        if not os.environ.get("DASHSCOPE_API_KEY"):
            self.send_error(500, "Server missing DASHSCOPE_API_KEY")
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
                self.send_error(400, "Missing uploaded photo")
                return

            suffix = Path(photo.filename).suffix or ".png"
            photo_path = work_dir / f"upload{suffix}"
            with photo_path.open("wb") as file:
                shutil.copyfileobj(photo.file, file)

            style = form.getfirst("style", "cartoon-pet")
            if style not in SUPPORTED_STYLES:
                self.send_error(400, "Unsupported generation style")
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
            if os.environ.get("GAOTA_SKIP_HEVC") == "1" or platform.system() != "Darwin":
                command.append("--skip-hevc")
            subprocess.run(command, cwd=ROOT, check=True)

            data = zip_path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "application/zip")
            self.send_header("Content-Disposition", 'attachment; filename="custompet.zip"')
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except subprocess.CalledProcessError as error:
            self.send_error(500, f"Generation failed with exit code {error.returncode}")
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
