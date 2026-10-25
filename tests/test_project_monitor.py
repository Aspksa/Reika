import tempfile
import unittest
from pathlib import Path

from reika.project_monitor import ProjectMonitor, inspect, owner_for


class ProjectMonitorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / "src").mkdir()
        (self.root / "src" / "app.py").write_text("first", encoding="utf-8")
        self.registry = {"components": {
            "core": {"paths": ["src/"], "dependencies": [{"target": "missing"}]},
            "extra": {"paths": ["absent.txt"], "dependencies": []},
        }}

    def tearDown(self):
        self.temp.cleanup()

    def test_owner_rules(self):
        self.assertEqual(owner_for("src/app.py", self.registry["components"]), ["core"])
        self.assertEqual(owner_for("misc/unknown.py", self.registry["components"]), [])

    def test_broken_links_and_missing_paths(self):
        status = inspect(self.root, self.registry)
        self.assertEqual(status["invalid_links"], [{"source": "core", "target": "missing"}])
        self.assertIn({"module": "extra", "path": "absent.txt"}, status["missing"])

    def test_snapshot_changes_and_bounded_journal(self):
        # Monitor uses the real registry paths, but a temp project can still test
        # that unchanged snapshots do not generate fictional events.
        from unittest.mock import patch
        sample = {"files": {"src/app.py": {"module": ["core"], "size": 5, "mtime_ns": 1}},
                  "missing": [], "invalid_links": [], "unowned": [], "ambiguous": [],
                  "candidates": [], "version_problem": None, "limit_reached": False}
        monitor = ProjectMonitor(self.root, interval=0)
        with patch("reika.project_monitor.inspect", return_value=sample):
            self.assertEqual(monitor.status()["events"], [])
        changed = {**sample, "files": {"src/app.py": {"module": ["core"], "size": 6, "mtime_ns": 2}}}
        with patch("reika.project_monitor.inspect", return_value=changed):
            result = monitor.status()
        self.assertEqual(result["events"][0]["changes"][0]["action"], "modified")
        self.assertTrue(monitor.journal.exists())
