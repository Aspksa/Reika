"""Read the project's version registry; dependency versions keep their own numbers."""

import json
import re
from pathlib import Path


def validate_versions(data):
    pattern = r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)"
    if not isinstance(data, dict) or data.get("schema") != 1:
        raise ValueError("Неверный формат versions.json.")
    if not isinstance(data.get("project"), str) or not re.fullmatch(pattern, data["project"]):
        raise ValueError("Неверная версия проекта в versions.json.")
    components = data.get("components")
    if not isinstance(components, dict) or not components:
        raise ValueError("В versions.json отсутствуют компоненты.")
    for key, item in components.items():
        if (not re.fullmatch(r"[a-z][a-z0-9_]*", key) or not isinstance(item, dict)
                or not isinstance(item.get("name"), str) or not item["name"].strip()
                or not isinstance(item.get("version"), str) or not re.fullmatch(pattern, item["version"])):
            raise ValueError("Неверная версия компонента в versions.json.")
    return data


REGISTRY = validate_versions(json.loads(
    (Path(__file__).resolve().parents[1] / "versions.json").read_text(encoding="utf-8")
))
PROJECT_VERSION = REGISTRY["project"]
COMPONENTS = {key: {field: value[field] for field in ("name", "version", "description", "status", "dependencies")}
              for key, value in REGISTRY["components"].items()}
COMPONENT_VERSIONS = {key: value["version"] for key, value in COMPONENTS.items()}
