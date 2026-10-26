"""Bounded local project inventory and read-only health diagnostics.

Scans only registered project-owned paths. Never reads file contents, except build.json
which is already a public release manifest. Journal stores relative paths, not secrets.
"""
from __future__ import annotations

import json
import os
import tempfile
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from .versions import REGISTRY, COMPONENT_VERSIONS, PROJECT_VERSION

IGNORED = {".git", ".venv", "node_modules", "__pycache__", ".pytest_cache", "logs", ".secrets", "secrets"}
SKIP_NAMES = {".env", ".env.local", ".env.production", "credentials.json", "token.json"}
LIMIT = 2500
INTERVAL = 30
HISTORY_LIMIT = 20
FINDING_LIMIT = 80


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


def findings_for(snapshot: dict) -> tuple[dict, bool]:
    """Stable, bounded findings from facts already collected by the local scan."""
    records = []
    for item in snapshot["missing"]:
        records.append({"id": f"missing:{item['module']}:{item['path']}", "kind": "missing",
                        "module": item["module"], "title": f"Отсутствует путь: {item['path']}"})
    for item in snapshot["invalid_links"]:
        records.append({"id": f"link:{item['source']}:{item['target']}", "kind": "link",
                        "module": item["source"], "title": f"Ошибочная связь: {item['source']} → {item['target']}"})
    for path in snapshot["ambiguous"]:
        records.append({"id": f"ambiguous:{path}", "kind": "ambiguous",
                        "module": None, "title": f"Неоднозначный владелец: {path}"})
    for path in snapshot["unowned"]:
        records.append({"id": f"unowned:{path}", "kind": "unowned",
                        "module": None, "title": f"Файл без владельца: {path}"})
    if snapshot["version_problem"]:
        records.append({"id": "build", "kind": "build", "module": None,
                        "title": snapshot["version_problem"]})
    if snapshot["limit_reached"]:
        records.append({"id": "limit", "kind": "limit", "module": None,
                        "title": "Проверка ограничена; часть файлов не просмотрена."})
    records.sort(key=lambda item: item["id"])
    return {item["id"]: item for item in records[:FINDING_LIMIT]}, len(records) > FINDING_LIMIT


class ProjectMonitor:
    def __init__(self, root: Path, interval: int = INTERVAL):
        self.root = root
        self.interval = interval
        self.lock = threading.Lock()
        self.snapshot = None
        self.checked_monotonic = 0
        self.events = []
        self.journal = root / "logs" / "project-monitor.jsonl"
        self.history_file = root / "logs" / "project-health.json"
        self.history = self._read_history()
        previous = self.history[0].get("active_findings", []) if self.history else []
        self.previous_findings = {item["id"]: item for item in previous}
        self.finding_changes = {"new": [], "ongoing": [], "resolved": []}
        self.findings_truncated = False

    def _read_history(self):
        try:
            if self.history_file.parent.is_symlink() or self.history_file.is_symlink() or self.history_file.stat().st_size > 1024 * 1024:
                return []
            data = json.loads(self.history_file.read_text(encoding="utf-8"))
            if not isinstance(data, list):
                return []
            history = []
            for item in data[:HISTORY_LIMIT]:
                if not isinstance(item, dict) or not isinstance(item.get("at"), str):
                    continue
                active = item.get("active_findings")
                if not isinstance(active, list) or len(active) > FINDING_LIMIT:
                    continue
                if not all(isinstance(record, dict)
                           and isinstance(record.get("id"), str) and len(record["id"]) <= 500
                           and isinstance(record.get("title"), str) and len(record["title"]) <= 500
                           and isinstance(record.get("kind"), str) and len(record["kind"]) <= 30
                           and (record.get("module") is None or
                                isinstance(record["module"], str) and len(record["module"]) <= 100)
                           for record in active):
                    continue
                safe = [{key: record.get(key) for key in ("id", "kind", "module", "title")}
                        for record in active]
                history.append({"at": item["at"][:40], "active_findings": safe,
                                "new": int(item.get("new", 0)), "resolved": int(item.get("resolved", 0))})
            return history
        except (OSError, ValueError, TypeError, KeyError):
            return []

    def _save_history(self):
        temporary = None
        try:
            if self.history_file.parent.is_symlink():
                return
            self.history_file.parent.mkdir(exist_ok=True)
            with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False,
                                             dir=self.history_file.parent, prefix=".project-health-") as file:
                temporary = Path(file.name)
                json.dump(self.history, file, ensure_ascii=False)
            os.replace(temporary, self.history_file)
        except OSError:
            pass
        finally:
            if temporary:
                try:
                    temporary.unlink(missing_ok=True)
                except OSError:
                    pass

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
                found, self.findings_truncated = findings_for(current)
                previous_findings = self.previous_findings
                self.finding_changes = {
                    "new": [item for key, item in found.items() if key not in previous_findings],
                    "ongoing": [item for key, item in found.items() if key in previous_findings],
                    "resolved": [item for key, item in previous_findings.items() if key not in found],
                }
                self.previous_findings = found
                self.history.insert(0, {"at": now, "active_findings": list(found.values()),
                                        "new": len(self.finding_changes["new"]),
                                        "resolved": len(self.finding_changes["resolved"])})
                self.history = self.history[:HISTORY_LIMIT]
                self._save_history()
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
                           "findings": self.finding_changes,
                           "findings_truncated": self.findings_truncated,
                           "diagnostic_history": [
                               {"at": item["at"], "active": len(item["active_findings"]),
                                "new": item["new"], "resolved": item["resolved"]}
                               for item in self.history
                           ],
                           "module_health": {
                               id: "problem" if any(x["module"] == id for x in result["missing"])
                               else "warning" if any(x["source"] == id for x in result["invalid_links"])
                               else "healthy" for id in REGISTRY["components"]
                           }})
            return result
