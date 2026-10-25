"""Bounded local project inventory and read-only health diagnostics.

Scans only registered project-owned paths. Never reads file contents, except build.json
which is already a public release manifest. Journal stores relative paths, not secrets.
"""
from __future__ import annotations

import json
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from .versions import REGISTRY, COMPONENT_VERSIONS, PROJECT_VERSION

IGNORED = {".git", ".venv", "node_modules", "__pycache__", ".pytest_cache", "logs", ".secrets", "secrets"}
SKIP_NAMES = {".env", ".env.local", ".env.production", "credentials.json", "token.json"}
LIMIT = 2500
INTERVAL = 30


def owner_for(path: str, components: dict) -> list[str]:
    matches = []
    for module, data in components.items():
        for prefix in data.get("paths", []):
            if path == prefix.rstrip("/") or (prefix.endswith("/") and path.startswith(prefix)):
                matches.append((len(prefix), module))
    if not matches:
        return []
    best = max(length for length, _ in matches)
    return sorted({module for length, module in matches if length == best})


def inspect(root: Path, registry: dict = REGISTRY) -> dict:
    components = registry["components"]
    inventory = {}
    missing = []
    candidates = []
    ignored = 0
    # The registry is treated as data; never follow symlinks outside the project.
    root = root.resolve()
    for module, data in components.items():
        for spec in data.get("paths", []):
            target = root / spec
            if not target.is_relative_to(root) or target.is_symlink() or not target.exists():
                missing.append({"module": module, "path": spec})
                continue
            files = [target] if target.is_file() else target.rglob("*")
            for path in files:
                if len(inventory) >= LIMIT:
                    ignored += 1
                    break
                relative = path.relative_to(root)
                if any(part in IGNORED for part in relative.parts) or path.name.lower() in SKIP_NAMES:
                    continue
                if path.is_symlink() or not path.is_file():
                    continue
                try:
                    stat = path.stat()
                except OSError:
                    continue
                name = relative.as_posix()
                inventory[name] = {"module": owner_for(name, components), "size": stat.st_size,
                                   "mtime_ns": stat.st_mtime_ns}
    invalid = [{"source": source, "target": link.get("target")}
               for source, data in components.items() for link in data.get("dependencies", [])
               if link.get("target") not in components]
    unknown = sorted([path for path, state in inventory.items() if not state["module"]])
    ambiguous = sorted([path for path, state in inventory.items() if len(state["module"]) > 1])
    # Optional suggestions, not automatic registrations: top-level directories only.
    for child in root.iterdir():
        if child.is_dir() and child.name not in IGNORED and not child.name.startswith("."):
            prefix = child.name + "/"
            if not any(spec == prefix or spec.startswith(prefix) for item in components.values() for spec in item.get("paths", [])):
                candidates.append(prefix)
    version_problem = None
    try:
        manifest = json.loads((root / "web/dist/build.json").read_text(encoding="utf-8"))
        if manifest.get("version") != PROJECT_VERSION or manifest.get("components") != COMPONENT_VERSIONS:
            version_problem = "Версия готовой сборки не совпадает с реестром."
    except (OSError, ValueError, TypeError):
        version_problem = "Манифест готовой сборки отсутствует или повреждён."
    return {"files": inventory, "missing": missing, "invalid_links": invalid,
            "unowned": unknown, "ambiguous": ambiguous, "candidates": candidates,
            "version_problem": version_problem, "limit_reached": ignored > 0}


class ProjectMonitor:
    def __init__(self, root: Path, interval: int = INTERVAL):
        self.root = root
        self.interval = interval
        self.lock = threading.Lock()
        self.snapshot = None
        self.checked_monotonic = 0
        self.events = []
        self.journal = root / "logs" / "project-monitor.jsonl"

    def status(self, force: bool = False) -> dict:
        with self.lock:
            if force or not self.snapshot or time.monotonic() - self.checked_monotonic >= self.interval:
                current = inspect(self.root)
                before = self.snapshot["files"] if self.snapshot else {}
                changed = []
                if self.snapshot:
                    for path in sorted(set(before) | set(current["files"])):
                        a, b = before.get(path), current["files"].get(path)
                        if a != b:
                            changed.append({"path": path, "action": "created" if not a else "deleted" if not b else "modified",
                                            "modules": (b or a)["module"]})
                now = datetime.now(timezone.utc).isoformat()
                self.snapshot = current
                self.checked_monotonic = time.monotonic()
                if changed:
                    event = {"at": now, "source": "локальное сканирование", "count": len(changed),
                             "changes": changed[:80]}
                    self.events.insert(0, event)
                    self.events = self.events[:25]
                    try:
                        self.journal.parent.mkdir(exist_ok=True)
                        with self.journal.open("a", encoding="utf-8") as file:
                            file.write(json.dumps(event, ensure_ascii=False) + "\n")
                    except OSError:
                        pass
                self.last_checked = now
            result = {key: value for key, value in self.snapshot.items() if key != "files"}
            result.update({"checked_at": self.last_checked, "file_count": len(self.snapshot["files"]),
                           "events": list(self.events),
                           "module_health": {
                               id: "problem" if any(x["module"] == id for x in result["missing"])
                               else "warning" if any(x["source"] == id for x in result["invalid_links"])
                               else "healthy" for id in REGISTRY["components"]
                           }})
            return result
