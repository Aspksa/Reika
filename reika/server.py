"""Loopback-only HTTP server with an explicit static-file allowlist."""

from __future__ import annotations

import hmac
import hashlib
import json
import logging
import os
import platform
import re
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, unquote

from .updates import Updates
from . import __version__
from .versions import COMPONENTS, COMPONENT_VERSIONS


LOGGER = logging.getLogger("reika.http")
CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".webp": "image/webp", ".avif": "image/avif", ".gif": "image/gif",
    ".woff": "font/woff", ".woff2": "font/woff2",
}


def load_assets(web_root: Path) -> dict:
    directory = web_root / "dist"
    try:
        manifest = json.loads((directory / "build.json").read_text(encoding="utf-8"))
        if manifest.get("version") != __version__:
            raise ValueError("Версия сборки интерфейса не совпадает с версией Reika.")
        if manifest.get("components") != COMPONENT_VERSIONS:
            raise ValueError("Версии компонентов сборки не совпадают с versions.json.")
        entries = manifest["files"]
        if not isinstance(entries, dict) or "index.html" not in entries:
            raise ValueError("Неверный список файлов интерфейса.")
        assets = {}
        for name, digest in entries.items():
            if name != "index.html" and not re.fullmatch(r"assets/[\w.-]+\.(css|js|svg|png|jpg|jpeg|webp|avif|gif|woff|woff2)", name):
                raise ValueError("Недопустимый путь в сборке интерфейса.")
            path = directory / name
            if not path.resolve().is_relative_to(directory.resolve()):
                raise ValueError("Файл находится за пределами сборки интерфейса.")
            body = path.read_bytes()
            if not isinstance(digest, str) or hashlib.sha256(body).hexdigest() != digest:
                raise ValueError(f"Файл интерфейса повреждён: {name}")
            assets["/" if name == "index.html" else "/" + name] = (body, CONTENT_TYPES[path.suffix])
        if not any(name.endswith(".css") for name in entries) or not any(name.endswith(".js") for name in entries):
            raise ValueError("В сборке отсутствуют стили или JavaScript.")
        return assets
    except (OSError, ValueError, TypeError, KeyError) as error:
        raise RuntimeError(
            "Не удалось загрузить готовый интерфейс. Полностью распакуйте свежий архив Reika; "
            "при разработке выполните npm ci и npm run build. " + str(error)
        ) from error


class ReikaServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False

    def __init__(self, web_root: Path, instance_id: str, control_token: str):
        # Validate and load required files before claiming a port or readiness.
        self.assets = load_assets(web_root)
        project_root = web_root.parent
        self.project = {
            "modules": COMPONENTS,
            "history": json.loads((project_root / "releases/history.json").read_text(encoding="utf-8"))["releases"][:20],
            "pending": [json.loads(path.read_text(encoding="utf-8"))
                        for path in sorted((project_root / ".changes").glob("*.json"))],
        }
        self.updates = Updates()
        self.instance_id = instance_id
        self.control_token = control_token
        self.stop_requested = threading.Event()
        self.tray_active = False
        self.started = time.monotonic()
        self.started_at = datetime.now(timezone.utc).isoformat()
        # The OS chooses and reserves a free port in one operation.
        super().__init__(("127.0.0.1", 0), ReikaHandler)
        self.url = f"http://127.0.0.1:{self.server_address[1]}"

    def status(self) -> dict:
        return {
            "app": "Reika",
            "full_name": "Рэйка Амацухара",
            "version": __version__,
            "components": COMPONENTS,
            "status": "ready",
            "instance_id": self.instance_id,
            "url": self.url,
            "pid": os.getpid(),
            "started_at": self.started_at,
            "uptime_seconds": int(time.monotonic() - self.started),
            "platform": platform.system(),
            "python": platform.python_version(),
            "tray_active": self.tray_active,
        }


class ReikaHandler(BaseHTTPRequestHandler):
    server: ReikaServer
    server_version = "Reika"
    sys_version = ""

    def setup(self):
        super().setup()
        self.connection.settimeout(3)

    def log_message(self, message, *args):
        # Never log headers, bodies, tokens, or arbitrary URL text.
        pass

    def log_request(self, code="-", size="-"):
        LOGGER.debug("HTTP %s", code)

    def _send(self, status: int, body: bytes, content_type: str):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'none'; script-src 'self'; style-src 'self'; "
            "img-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'none'; "
            "frame-ancestors 'none'; form-action 'none'",
        )
        self.end_headers()
        if self.command != "HEAD":
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def _json(self, status: int, payload: dict):
        self._send(
            status,
            json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            "application/json; charset=utf-8",
        )

    def _allowed_request(self) -> bool:
        hosts = self.headers.get_all("Host", [])
        if hosts != [f"127.0.0.1:{self.server.server_address[1]}"]:
            self._json(403, {"error": "Недопустимый адрес запроса."})
            return False
        origins = self.headers.get_all("Origin", [])
        if origins and origins != [self.server.url]:
            self._json(403, {"error": "Запрос с другого сайта отклонён."})
            return False
        if self.headers.get("Sec-Fetch-Site") == "cross-site":
            self._json(403, {"error": "Запрос с другого сайта отклонён."})
            return False
        return True

    def _route(self) -> str:
        try:
            parsed = urlsplit(self.path)
        except ValueError:
            return ""
        # Reject proxy-form requests; only ordinary absolute paths are served.
        return unquote(parsed.path) if not parsed.scheme and not parsed.netloc else ""

    def do_GET(self):
        if not self._allowed_request():
            return
        route = self._route()
        if route == "/api/status":
            self._json(200, self.server.status())
        elif route == "/api/updates":
            self._json(200, self.server.updates.get())
        elif route == "/api/project":
            self._json(200, self.server.project)
        elif route in self.server.assets:
            body, content_type = self.server.assets[route]
            self._send(200, body, content_type)
        else:
            self._json(404, {"error": "Страница не найдена."})

    def do_HEAD(self):
        self.do_GET()

    def do_POST(self):
        if not self._allowed_request():
            return
        if self._route() != "/api/shutdown":
            self._json(404, {"error": "Команда не найдена."})
            return
        tokens = self.headers.get_all("X-Reika-Token", [])
        if len(tokens) != 1 or not hmac.compare_digest(
            tokens[0].encode("utf-8"), self.server.control_token.encode("utf-8")
        ):
            self._json(403, {"error": "Команда не авторизована."})
            return
        lengths = self.headers.get_all("Content-Length", [])
        if self.headers.get_all("Transfer-Encoding") or len(lengths) > 1:
            self._json(400, {"error": "Недопустимый формат запроса."})
            return
        try:
            length = int(lengths[0]) if lengths else 0
        except ValueError:
            length = -1
        if length != 0:
            self._json(400, {"error": "Эта команда не принимает данные."})
            return
        self._json(200, {"status": "stopping"})
        self.server.stop_requested.set()

    def do_OPTIONS(self):
        if self._allowed_request():
            self._json(405, {"error": "Метод не поддерживается."})
