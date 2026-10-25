"""Project Chronicle: append-only events and verifiable commit/task links."""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / ".chronicle"
LOG = DATA / "events.jsonl"
IDENTITY = re.compile(r"^(BUG|TASK)-[0-9]{4,}$")
SHA = re.compile(r"^[a-f0-9]{40}$")
STATUSES = {
    "opened", "triaged", "in_progress", "fix_proposed",
    "verified", "closed", "reopened",
}
ACTIONS = {"started", "analyzed", "proposed", "changed", "tested", "failed", "finished"}
TRAILER = re.compile(r"^(?:Task-Id|Fixes-Id|Refs-Id):\s*((?:BUG|TASK)-[0-9]{4,})\s*$", re.I | re.M)

def run_git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True, encoding="utf-8").strip()

def read_events():
    if not LOG.exists():
        return []
    entries = []
    for n, line in enumerate(LOG.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        event = json.loads(line)
        if not isinstance(event, dict) or not isinstance(event.get("event_id"), str):
            raise ValueError(f"Некорректное событие в строке {n}")
        entries.append(event)
    if len({x["event_id"] for x in entries}) != len(entries):
        raise ValueError("Повторяющиеся идентификаторы событий")
    return entries

def append(kind, record):
    DATA.mkdir(parents=True, exist_ok=True)
    entry = dict(schema=1, event_id=str(uuid.uuid4()), timestamp=dt.datetime.now(dt.timezone.utc).isoformat(),
                 kind=kind, **record)
    # One JSON object per line; never mutate or silently rewrite prior history.
    with LOG.open("a", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(entry, ensure_ascii=False, sort_keys=True) + "\n")
        f.flush()
        os.fsync(f.fileno())
    return entry

def status_map(entries):
    states = {}
    for entry in entries:
        if entry["kind"] == "problem":
            states[entry["problem_id"]] = entry["status"]
    return states

def record_problem(args):
    if not IDENTITY.fullmatch(args.id) or not args.id.startswith("BUG-"):
        raise ValueError("Ожидается идентификатор BUG-0001")
    if not args.details.strip():
        raise ValueError("Описание не может быть пустым")
    previous = status_map(read_events()).get(args.id)
    if previous is None and args.status != "opened":
        raise ValueError("Первая запись проблемы должна иметь статус opened")
    if previous is not None and args.status == "opened":
        raise ValueError("Существующую проблему нужно переоткрыть через reopened")
    if args.status == "closed" and previous != "verified":
        raise ValueError("Закрывать можно только подтверждённую (verified) проблему")
    if args.status == "reopened" and previous != "closed":
        raise ValueError("Повторно открыть можно только закрытую проблему")
    if args.status == "verified" and previous not in {"fix_proposed", "in_progress"}:
        raise ValueError("Подтверждение требует предварительной попытки исправления")
    return append("problem", dict(problem_id=args.id, status=args.status,
                                   details=args.details, evidence=args.evidence or "",
                                   actor=args.actor))

def record_agent(args):
    if not IDENTITY.fullmatch(args.task):
        raise ValueError("Ожидается TASK-0001 или BUG-0001")
    if not args.agent.strip() or not args.details.strip():
        raise ValueError("Нужны агент и содержательное описание")
    return append("agent", dict(agent_id=args.agent, task_id=args.task,
                                action=args.action, details=args.details,
                                evidence=args.evidence or ""))

def commit_links(base, head):
    # Git history, not a model-generated claim, is authoritative.
    output = run_git("rev-list", "--reverse", f"{base}..{head}")
    found = []
    for sha in filter(None, output.splitlines()):
        message = run_git("show", "-s", "--format=%B", sha)
        ids = sorted(set(TRAILER.findall(message)))
        # Also preserve commits that have no declared task: never invent attribution.
        found.append({"sha": sha, "task_ids": ids, "verified": bool(ids)})
    return found

def validate():
    entries = read_events()
    known = set()
    for entry in entries:
        if entry.get("schema") != 1 or entry.get("kind") not in {"problem", "agent"}:
            raise ValueError("Неизвестный формат события")
        if entry["kind"] == "problem":
            if not IDENTITY.fullmatch(entry.get("problem_id", "")) or entry.get("status") not in STATUSES:
                raise ValueError("Недопустимая запись проблемы")
            known.add(entry["problem_id"])
        if entry["kind"] == "agent":
            if not IDENTITY.fullmatch(entry.get("task_id", "")) or entry.get("action") not in ACTIONS:
                raise ValueError("Недопустимая запись агента")
    return {"events": len(entries), "problems": len(known),
            "agents": len({e["agent_id"] for e in entries if e["kind"] == "agent"})}

def main(argv=None):
    p = argparse.ArgumentParser(description="Reika Project Chronicle")
    sub = p.add_subparsers(dest="command", required=True)
    problem = sub.add_parser("problem")
    problem.add_argument("--id", required=True)
    problem.add_argument("--status", required=True, choices=sorted(STATUSES))
    problem.add_argument("--details", required=True)
    problem.add_argument("--evidence", default="")
    problem.add_argument("--actor", default="unknown")
    agent = sub.add_parser("agent")
    agent.add_argument("--agent", required=True)
    agent.add_argument("--task", required=True)
    agent.add_argument("--action", required=True, choices=sorted(ACTIONS))
    agent.add_argument("--details", required=True)
    agent.add_argument("--evidence", default="")
    links = sub.add_parser("links")
    links.add_argument("--base", required=True)
    links.add_argument("--head", default="HEAD")
    sub.add_parser("validate")
    args = p.parse_args(argv)
    if args.command == "problem":
        result = record_problem(args)
    elif args.command == "agent":
        result = record_agent(args)
    elif args.command == "links":
        result = commit_links(args.base, args.head)
    else:
        result = validate()
    print(json.dumps(result, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print(f"Chronicle: {error}", file=sys.stderr)
        sys.exit(1)
