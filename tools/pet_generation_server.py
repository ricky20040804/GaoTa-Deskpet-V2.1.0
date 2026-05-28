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
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SUPPORTED_STYLES = {"cartoon-pet", "real-pet", "cartoon-portrait"}
SUPPORTED_PLANS = {"pet-package", "complete-package", "portrait-package"}
ALLOWED_IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}
ALLOWED_IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp"}
MAX_UPLOAD_BYTES = int(os.environ.get("GAOTA_MAX_UPLOAD_BYTES", str(15 * 1024 * 1024)))
MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + int(os.environ.get("GAOTA_MAX_MULTIPART_OVERHEAD_BYTES", str(1024 * 1024)))
PHONE_PATTERN = re.compile(r"^1[3-9]\d{9}$")
VALID_PHONE_PREFIXES = {
    "130", "131", "132", "133", "134", "135", "136", "137", "138", "139",
    "145", "146", "147", "148", "149",
    "150", "151", "152", "153", "155", "156", "157", "158", "159",
    "162", "165", "166", "167",
    "170", "171", "172", "173", "174", "175", "176", "177", "178",
    "180", "181", "182", "183", "184", "185", "186", "187", "188",
    "190", "191", "192", "193", "195", "196", "197", "198", "199",
}
SESSION_TTL_SECONDS = 30 * 24 * 60 * 60
DEFAULT_GENERATION_LIMIT = int(os.environ.get("GAOTA_GENERATION_LIMIT", "3"))
AUTH_DB_PATH = Path(os.environ.get("GAOTA_AUTH_DB", ROOT / "data/gaota_auth.sqlite3"))
PASSWORD_HASH_ROUNDS = 120_000
DEVICE_REGISTER_LIMIT = int(os.environ.get("GAOTA_DEVICE_REGISTER_LIMIT", "1"))
RATE_LIMITS = {
    "register": (int(os.environ.get("GAOTA_REGISTER_RATE_LIMIT", "3")), 10 * 60),
    "login": (int(os.environ.get("GAOTA_LOGIN_RATE_LIMIT", "20")), 10 * 60),
    "generate": (int(os.environ.get("GAOTA_GENERATE_RATE_LIMIT", "3")), 60 * 60),
}
RATE_BUCKETS: dict[str, list[int]] = {}
RATE_LOCK = threading.Lock()


def now() -> int:
    return int(time.time())


def hash_secret(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def hash_password(password: str, salt_hex: str) -> str:
    return hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        bytes.fromhex(salt_hex),
        PASSWORD_HASH_ROUNDS,
    ).hex()


def valid_username(username: str) -> bool:
    return 2 <= len(username) <= 20


def valid_password(password: str) -> bool:
    return 6 <= len(password) <= 64


def mask_phone(phone: str) -> str:
    return f"{phone[:3]}****{phone[-4:]}"


def valid_phone(phone: str) -> bool:
    return bool(PHONE_PATTERN.fullmatch(phone)) and phone[:3] in VALID_PHONE_PREFIXES


def valid_device_id(device_id: str) -> bool:
    return bool(re.fullmatch(r"[A-Za-z0-9_-]{16,128}", device_id))


def device_hash(device_id: str) -> str:
    return hash_secret(device_id)


def rate_limited(key: str, limit: int, window_seconds: int) -> bool:
    current_time = now()
    with RATE_LOCK:
        bucket = RATE_BUCKETS.setdefault(key, [])
        bucket[:] = [timestamp for timestamp in bucket if current_time - timestamp < window_seconds]
        if len(bucket) >= limit:
            return True
        bucket.append(current_time)
        return False


def valid_image_upload(filename: str, content_type: str) -> bool:
    suffix = Path(filename).suffix.lower()
    mime_type = content_type.split(";", 1)[0].strip().lower()
    return suffix in ALLOWED_IMAGE_SUFFIXES and mime_type in ALLOWED_IMAGE_TYPES


def copy_upload_file(upload, destination: Path) -> None:
    total_bytes = 0
    with destination.open("wb") as file:
        while True:
            chunk = upload.file.read(1024 * 1024)
            if not chunk:
                break
            total_bytes += len(chunk)
            if total_bytes > MAX_UPLOAD_BYTES:
                raise ValueError("uploaded image is too large")
            file.write(chunk)


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
                username TEXT NOT NULL UNIQUE,
                password_salt TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                device_hash TEXT,
                generation_count INTEGER NOT NULL DEFAULT 0,
                generation_limit INTEGER NOT NULL DEFAULT 3,
                created_at INTEGER NOT NULL
            );

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
        columns = {row["name"] for row in db.execute("PRAGMA table_info(users)").fetchall()}
        if "username" not in columns:
            db.execute("ALTER TABLE users ADD COLUMN username TEXT")
        if "password_salt" not in columns:
            db.execute("ALTER TABLE users ADD COLUMN password_salt TEXT")
        if "password_hash" not in columns:
            db.execute("ALTER TABLE users ADD COLUMN password_hash TEXT")
        if "device_hash" not in columns:
            db.execute("ALTER TABLE users ADD COLUMN device_hash TEXT")
        db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username) WHERE username IS NOT NULL")
        db.execute("CREATE INDEX IF NOT EXISTS idx_users_device_hash ON users(device_hash) WHERE device_hash IS NOT NULL")


def user_payload(user: sqlite3.Row) -> dict:
    remaining = max(0, int(user["generation_limit"]) - int(user["generation_count"]))
    username = user["username"] or mask_phone(user["phone"])
    return {
        "id": int(user["id"]),
        "phone": user["phone"],
        "username": username,
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


def create_session(db: sqlite3.Connection, user_id: int) -> str:
    current_time = now()
    token = secrets.token_urlsafe(32)
    db.execute(
        "INSERT INTO sessions(token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
        (hash_secret(token), user_id, current_time + SESSION_TTL_SECONDS, current_time),
    )
    return token


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

    def client_ip(self) -> str:
        forwarded = self.headers.get("X-Forwarded-For", "")
        if forwarded:
            return forwarded.split(",")[0].strip()
        real_ip = self.headers.get("X-Real-IP", "").strip()
        if real_ip:
            return real_ip
        return self.client_address[0]

    def check_rate_limit(self, action: str, message: str) -> bool:
        limit, window_seconds = RATE_LIMITS[action]
        if rate_limited(f"{action}:{self.client_ip()}", limit, window_seconds):
            self.send_json(429, {"ok": False, "message": message})
            return False
        return True

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
        if self.path == "/api/auth/register":
            self.handle_register()
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
        if not self.check_rate_limit("generate", "生成请求太频繁，请稍后再试。"):
            return
        try:
            request_length = int(self.headers.get("Content-Length", "0") or "0")
        except ValueError:
            self.send_plain_error(400, "上传请求格式不正确。")
            return
        if request_length > MAX_REQUEST_BYTES:
            self.send_plain_error(413, "图片文件太大，请上传 15MB 以内的 PNG、JPG 或 WEBP 图片。")
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

            if not valid_image_upload(photo.filename, getattr(photo, "type", "") or ""):
                self.send_plain_error(400, "请上传 PNG、JPG 或 WEBP 格式的图片。")
                return

            suffix = Path(photo.filename).suffix.lower()
            photo_path = work_dir / f"upload{suffix}"
            try:
                copy_upload_file(photo, photo_path)
            except ValueError:
                self.send_plain_error(413, "图片文件太大，请上传 15MB 以内的 PNG、JPG 或 WEBP 图片。")
                return

            style = form.getfirst("style", "cartoon-pet")
            if style not in SUPPORTED_STYLES:
                self.send_plain_error(400, "这个生成风格暂时不支持，请重新选择。")
                return
            plan = form.getfirst("plan", "pet-package")
            if plan not in SUPPORTED_PLANS:
                self.send_plain_error(400, "这个生成方案暂时不支持，请重新选择。")
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
            if plan == "complete-package":
                command.append("--include-windows-main-js")
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

    def handle_register(self) -> None:
        if not self.check_rate_limit("register", "注册太频繁，请稍后再试。"):
            return

        try:
            payload = self.read_json()
            phone = str(payload.get("phone", "")).strip()
            username = str(payload.get("username", "")).strip()
            password = str(payload.get("password", ""))
            device_id = str(payload.get("deviceId", "")).strip()
        except Exception:
            self.send_json(400, {"ok": False, "message": "请求格式不正确。"})
            return

        if not valid_phone(phone):
            self.send_json(400, {"ok": False, "message": "请输入真实有效的中国大陆手机号。"})
            return
        if not valid_username(username):
            self.send_json(400, {"ok": False, "message": "用户名需要 2 到 20 个字符。"})
            return
        if not valid_password(password):
            self.send_json(400, {"ok": False, "message": "密码需要 6 到 64 个字符。"})
            return
        if not valid_device_id(device_id):
            self.send_json(400, {"ok": False, "message": "当前设备信息异常，请刷新页面后重试。"})
            return

        current_time = now()
        salt = secrets.token_hex(16)
        password_hash = hash_password(password, salt)
        current_device_hash = device_hash(device_id)
        with get_db() as db:
            device_register_count = db.execute(
                "SELECT COUNT(*) AS count FROM users WHERE device_hash = ?",
                (current_device_hash,),
            ).fetchone()["count"]
            if int(device_register_count) >= DEVICE_REGISTER_LIMIT:
                self.send_json(429, {"ok": False, "message": "当前设备注册次数已达上限，请直接登录已有账号。"})
                return
            existing_phone = db.execute("SELECT id FROM users WHERE phone = ?", (phone,)).fetchone()
            if existing_phone:
                self.send_json(409, {"ok": False, "message": "这个手机号已经注册过，请直接登录。"})
                return
            existing_username = db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
            if existing_username:
                self.send_json(409, {"ok": False, "message": "这个用户名已经被使用，请换一个。"})
                return
            cursor = db.execute(
                """
                INSERT INTO users(phone, username, password_salt, password_hash, device_hash, generation_count, generation_limit, created_at)
                VALUES (?, ?, ?, ?, ?, 0, ?, ?)
                """,
                (phone, username, salt, password_hash, current_device_hash, DEFAULT_GENERATION_LIMIT, current_time),
            )
            user = db.execute("SELECT * FROM users WHERE id = ?", (cursor.lastrowid,)).fetchone()
            token = create_session(db, int(user["id"]))

        self.send_json(200, {"ok": True, "token": token, "user": user_payload(user)})

    def handle_login(self) -> None:
        if not self.check_rate_limit("login", "登录太频繁，请稍后再试。"):
            return

        try:
            payload = self.read_json()
            phone = str(payload.get("phone", "")).strip()
            password = str(payload.get("password", ""))
        except Exception:
            self.send_json(400, {"ok": False, "message": "请求格式不正确。"})
            return

        if not valid_phone(phone):
            self.send_json(400, {"ok": False, "message": "请输入真实有效的中国大陆手机号。"})
            return
        if not valid_password(password):
            self.send_json(400, {"ok": False, "message": "请输入 6 到 64 位密码。"})
            return

        with get_db() as db:
            user = db.execute("SELECT * FROM users WHERE phone = ?", (phone,)).fetchone()
            if not user or not user["password_salt"] or not user["password_hash"]:
                self.send_json(401, {"ok": False, "message": "手机号或密码不正确。"})
                return
            expected_hash = hash_password(password, user["password_salt"])
            if not hmac.compare_digest(expected_hash, user["password_hash"]):
                self.send_json(401, {"ok": False, "message": "手机号或密码不正确。"})
                return
            token = create_session(db, int(user["id"]))

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
