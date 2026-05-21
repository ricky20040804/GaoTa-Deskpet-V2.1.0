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
import hashlib
import hmac
import json
import os
import re
import secrets
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SUPPORTED_STYLES = {"cartoon-pet", "real-pet", "cartoon-portrait"}
PHONE_PATTERN = re.compile(r"^1[3-9]\d{9}$")
CODE_TTL_SECONDS = 5 * 60
SESSION_TTL_SECONDS = 30 * 24 * 60 * 60
DEFAULT_GENERATION_LIMIT = int(os.environ.get("GAOTA_GENERATION_LIMIT", "3"))
AUTH_DB_PATH = Path(os.environ.get("GAOTA_AUTH_DB", ROOT / "data/gaota_auth.sqlite3"))


def now() -> int:
    return int(time.time())


def hash_secret(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def mask_phone(phone: str) -> str:
    return f"{phone[:3]}****{phone[-4:]}"


def valid_phone(phone: str) -> bool:
    return bool(PHONE_PATTERN.fullmatch(phone))


def get_db() -> sqlite3.Connection:
    AUTH_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(AUTH_DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def init_auth_db() -> None:
    with get_db() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phone TEXT NOT NULL UNIQUE,
                generation_count INTEGER NOT NULL DEFAULT 0,
                generation_limit INTEGER NOT NULL DEFAULT 3,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS phone_codes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phone TEXT NOT NULL,
                code_hash TEXT NOT NULL,
                expires_at INTEGER NOT NULL,
                used_at INTEGER,
                attempts INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_phone_codes_phone_created
            ON phone_codes(phone, created_at);

            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                token_hash TEXT NOT NULL UNIQUE,
                user_id INTEGER NOT NULL,
                expires_at INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            """
        )


def user_payload(user: sqlite3.Row) -> dict:
    remaining = max(0, int(user["generation_limit"]) - int(user["generation_count"]))
    return {
        "id": int(user["id"]),
        "phone": user["phone"],
        "maskedPhone": mask_phone(user["phone"]),
        "generationCount": int(user["generation_count"]),
        "generationLimit": int(user["generation_limit"]),
        "remainingGenerations": remaining,
    }


def find_user_by_token(token: str):
    if not token:
        return None

    token_hash = hash_secret(token)
    current_time = now()
    with get_db() as db:
        session = db.execute(
            """
            SELECT users.*
            FROM sessions
            JOIN users ON users.id = sessions.user_id
            WHERE sessions.token_hash = ? AND sessions.expires_at > ?
            """,
            (token_hash, current_time),
        ).fetchone()
    return session


def create_or_get_user(db: sqlite3.Connection, phone: str) -> sqlite3.Row:
    current_time = now()
    db.execute(
        """
        INSERT INTO users(phone, generation_count, generation_limit, created_at)
        VALUES (?, 0, ?, ?)
        ON CONFLICT(phone) DO NOTHING
        """,
        (phone, DEFAULT_GENERATION_LIMIT, current_time),
    )
    return db.execute("SELECT * FROM users WHERE phone = ?", (phone,)).fetchone()


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
        origin = self.headers.get("Origin")
        self.send_header("Access-Control-Allow-Origin", origin or "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
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

    def send_json(self, status: int, payload: dict) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def bearer_token(self) -> str:
        header = self.headers.get("Authorization", "")
        if not header.startswith("Bearer "):
            return ""
        return header.removeprefix("Bearer ").strip()

    def current_user(self):
        return find_user_by_token(self.bearer_token())

    def do_GET(self) -> None:
        if self.path != "/api/auth/me":
            self.send_plain_error(404, "接口不存在。")
            return

        user = self.current_user()
        if not user:
            self.send_json(200, {"authenticated": False, "user": None})
            return
        self.send_json(200, {"authenticated": True, "user": user_payload(user)})

    def do_POST(self) -> None:
        if self.path == "/api/auth/send-code":
            self.handle_send_code()
            return
        if self.path == "/api/auth/login":
            self.handle_login()
            return
        if self.path == "/api/auth/logout":
            self.handle_logout()
            return
        if self.path != "/api/generate-pet-package":
            self.send_plain_error(404, "接口不存在。")
            return

        user = self.current_user()
        if not user:
            self.send_plain_error(401, "请先登录手机号后再生成宠物资源包。")
            return
        if int(user["generation_count"]) >= int(user["generation_limit"]):
            self.send_plain_error(403, "当前账号的生成次数已经用完。")
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
            with get_db() as db:
                db.execute(
                    "UPDATE users SET generation_count = generation_count + 1 WHERE id = ?",
                    (int(user["id"]),),
                )
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

    def handle_send_code(self) -> None:
        try:
            payload = self.read_json()
            phone = str(payload.get("phone", "")).strip()
        except Exception:
            self.send_json(400, {"ok": False, "message": "请求格式不正确。"})
            return

        if not valid_phone(phone):
            self.send_json(400, {"ok": False, "message": "请输入正确的中国大陆手机号。"})
            return

        current_time = now()
        with get_db() as db:
            recent = db.execute(
                "SELECT created_at FROM phone_codes WHERE phone = ? ORDER BY created_at DESC LIMIT 1",
                (phone,),
            ).fetchone()
            if recent and current_time - int(recent["created_at"]) < 60:
                self.send_json(429, {"ok": False, "message": "验证码发送太频繁，请 60 秒后再试。"})
                return

            today_count = db.execute(
                "SELECT COUNT(*) AS count FROM phone_codes WHERE phone = ? AND created_at > ?",
                (phone, current_time - 24 * 60 * 60),
            ).fetchone()["count"]
            if int(today_count) >= 10:
                self.send_json(429, {"ok": False, "message": "今天验证码发送次数过多，请明天再试。"})
                return

            code = f"{secrets.randbelow(1_000_000):06d}"
            db.execute(
                "INSERT INTO phone_codes(phone, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?)",
                (phone, hash_secret(code), current_time + CODE_TTL_SECONDS, current_time),
            )

        print(f"[GaoTa Auth] 手机号 {mask_phone(phone)} 的登录验证码是：{code}", flush=True)
        self.send_json(200, {"ok": True, "message": "验证码已发送，请查看短信。"})

    def handle_login(self) -> None:
        try:
            payload = self.read_json()
            phone = str(payload.get("phone", "")).strip()
            code = str(payload.get("code", "")).strip()
        except Exception:
            self.send_json(400, {"ok": False, "message": "请求格式不正确。"})
            return

        if not valid_phone(phone):
            self.send_json(400, {"ok": False, "message": "请输入正确的中国大陆手机号。"})
            return
        if not re.fullmatch(r"\d{6}", code):
            self.send_json(400, {"ok": False, "message": "请输入 6 位验证码。"})
            return

        current_time = now()
        with get_db() as db:
            code_row = db.execute(
                """
                SELECT * FROM phone_codes
                WHERE phone = ? AND used_at IS NULL
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (phone,),
            ).fetchone()

            if not code_row or int(code_row["expires_at"]) < current_time:
                self.send_json(400, {"ok": False, "message": "验证码已过期，请重新获取。"})
                return
            if int(code_row["attempts"]) >= 5:
                self.send_json(400, {"ok": False, "message": "验证码错误次数过多，请重新获取。"})
                return
            if not hmac.compare_digest(code_row["code_hash"], hash_secret(code)):
                db.execute("UPDATE phone_codes SET attempts = attempts + 1 WHERE id = ?", (int(code_row["id"]),))
                self.send_json(400, {"ok": False, "message": "验证码不正确。"})
                return

            db.execute("UPDATE phone_codes SET used_at = ? WHERE id = ?", (current_time, int(code_row["id"])))
            user = create_or_get_user(db, phone)
            token = secrets.token_urlsafe(32)
            db.execute(
                "INSERT INTO sessions(token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
                (hash_secret(token), int(user["id"]), current_time + SESSION_TTL_SECONDS, current_time),
            )
            user = db.execute("SELECT * FROM users WHERE id = ?", (int(user["id"]),)).fetchone()

        self.send_json(200, {"ok": True, "token": token, "user": user_payload(user)})

    def handle_logout(self) -> None:
        token = self.bearer_token()
        if token:
            with get_db() as db:
                db.execute("DELETE FROM sessions WHERE token_hash = ?", (hash_secret(token),))
        self.send_json(200, {"ok": True})


def main() -> int:
    host = os.environ.get("GAOTA_GENERATION_HOST", "127.0.0.1")
    port = int(os.environ.get("GAOTA_GENERATION_PORT", "8765"))
    init_auth_db()
    server = ThreadingHTTPServer((host, port), PetGenerationHandler)
    print(f"Pet generation API listening on http://{host}:{port}/api/generate-pet-package")
    print(f"Auth database: {AUTH_DB_PATH}")
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
