"""Tests for problem lifecycle, agent records and commit attribution."""
import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from scripts import chronicle

class ChronicleTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.data = Path(self.tmp.name)
        self.patches = [
            patch.object(chronicle, "DATA", self.data),
            patch.object(chronicle, "LOG", self.data / "events.jsonl"),
        ]
        for p in self.patches:
            p.start()
            self.addCleanup(p.stop)

    def test_problem_lifecycle_and_append_only(self):
        def problem(status):
            return chronicle.main(["problem", "--id", "BUG-0001", "--status", status,
                                   "--details", "Ошибка загрузки", "--actor", "tester"])
        with contextlib.redirect_stdout(io.StringIO()):
            for status in ("opened", "triaged", "in_progress", "fix_proposed", "verified", "closed", "reopened"):
                problem(status)
        events = chronicle.read_events()
        self.assertEqual(len(events), 7)
        self.assertEqual(events[-1]["status"], "reopened")
        self.assertEqual(len({event["event_id"] for event in events}), 7)

    def test_invalid_closure_rejected(self):
        with self.assertRaisesRegex(ValueError, "Первая запись"):
            chronicle.main(["problem", "--id", "BUG-0002", "--status", "closed",
                            "--details", "Без проверки"])

    def test_agent_event_and_validation(self):
        with contextlib.redirect_stdout(io.StringIO()):
            chronicle.main(["agent", "--agent", "codex", "--task", "TASK-0128",
                            "--action", "tested", "--details", "Запущены unit-тесты"])
        self.assertEqual(chronicle.validate(), {"events": 1, "problems": 0, "agents": 1})

    def test_explicit_commit_link_only(self):
        with patch.object(chronicle, "run_git") as git:
            git.side_effect = ["a"*40+"\n"+"b"*40,
                               "Refactor rendering\n\nTask-Id: TASK-0128",
                               "Fix formatting"]
            results = chronicle.commit_links("start", "HEAD")
        self.assertEqual(results[0]["task_ids"], ["TASK-0128"])
        self.assertEqual(results[1]["task_ids"], [])
        self.assertFalse(results[1]["verified"])

if __name__ == "__main__":
    unittest.main()
