"""Read-only official release metadata; no installation or user-file access."""
import json
import re
import threading
import time
from datetime import datetime, timezone
from urllib.request import Request, urlopen
from urllib.error import URLError

from . import __version__

API = "https://api.github.com/repos/Aspksa/Reika/releases/latest"
BASE = "https://github.com/Aspksa/Reika/releases"
LIMIT = 1024 * 1024


def release_info(data):
    tag = data.get("tag_name", "")
    if data.get("draft") or data.get("prerelease") or not re.fullmatch(r"v\d+\.\d+\.\d+", tag):
        raise ValueError("Некорректная версия выпуска.")
    version = tag[1:]
    name = f"Reika-{version}.zip"
    asset = next((a for a in data.get("assets", []) if a.get("name") == name and a.get("state") == "uploaded"), None)
    archive = None
    if asset:
        digest = asset.get("digest") or ""
        url = f"{BASE}/download/{tag}/{name}"
        size = asset.get("size")
        if asset.get("browser_download_url") != url or type(size) is not int or size <= 0:
            raise ValueError("Некорректные сведения об архиве.")
        archive = {"name": name, "url": url, "size": size,
                   "sha256": digest[7:] if re.fullmatch(r"sha256:[a-f0-9]{64}", digest) else None}
    body = data.get("body")
    if not isinstance(body, str):
        body = "Описание выпуска пока не опубликовано."
    return {"version": version, "notes": body, "url": f"{BASE}/tag/{tag}", "archive": archive,
            "newer": tuple(map(int, version.split('.'))) > tuple(map(int, __version__.split('.')))}


class Updates:
    def __init__(self):
        self.lock = threading.Lock()
        self.expires = 0
        self.cached = None

    def get(self):
        with self.lock:
            if self.cached is not None and time.monotonic() < self.expires:
                return self.cached
            result = {"current": __version__, "release": None, "error": None,
                      "checked_at": datetime.now(timezone.utc).isoformat()}
            try:
                request = Request(API, headers={"Accept": "application/vnd.github+json", "User-Agent": "Reika-update-check"})
                with urlopen(request, timeout=8) as response:
                    raw = response.read(LIMIT + 1)
                if len(raw) > LIMIT:
                    raise ValueError("Ответ сервера слишком большой.")
                result["release"] = release_info(json.loads(raw))
            except (OSError, URLError, ValueError, TypeError, KeyError, AttributeError):
                result["error"] = "Не удалось проверить выпуск. Проверьте интернет; GitHub также может временно ограничивать запросы. Повторите через минуту."
            self.cached = result
            self.expires = time.monotonic() + 60
            return result
