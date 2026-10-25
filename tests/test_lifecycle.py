import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

from reika.app import InstanceLock, existing_url, start_tray, stop_tray
from reika.server import ReikaServer


ROOT = Path(__file__).resolve().parents[1]


class LifecycleTests(unittest.TestCase):
    def test_lock_excludes_other_process_and_releases(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "instance.lock"
            lock = InstanceLock(path)
            self.assertTrue(lock.acquire())
            code = (
                "import sys; from pathlib import Path; from reika.app import InstanceLock; "
                "lock=InstanceLock(Path(sys.argv[1])); result=lock.acquire(); "
                "lock.close(); print(result)"
            )
            try:
                first = subprocess.check_output([sys.executable, "-c", code, str(path)], cwd=ROOT, text=True)
                self.assertEqual(first.strip(), "False")
            finally:
                lock.close()
            second = subprocess.check_output([sys.executable, "-c", code, str(path)], cwd=ROOT, text=True)
            self.assertEqual(second.strip(), "True")

    def test_corrupt_or_foreign_state_is_not_opened(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "instance.json"
            for content in ("{broken", '{}', '{"url":"https://example.com"}',
                            '{"url":"http://user@127.0.0.1:1234"}',
                            '{"url":"http://127.0.0.1:1234/evil"}'):
                path.write_text(content, encoding="utf-8")
                self.assertIsNone(existing_url(path, wait_seconds=0.01))

    def copy_project(self, parent):
        destination = Path(parent) / "Рэйка путь & (проверка)!"
        shutil.copytree(ROOT, destination, ignore=shutil.ignore_patterns(
            ".runtime", "logs", "__pycache__", ".git", ".venv", "node_modules", "test-results"
        ))
        return destination

    def test_full_launch_duplicate_and_recovery_from_forced_stop(self):
        with tempfile.TemporaryDirectory() as temporary:
            project = self.copy_project(temporary)
            command = [sys.executable, "-X", "utf8", "-B", str(project / "run.py"), "--no-browser", "--no-tray"]
            process = subprocess.Popen(command, cwd=temporary, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            try:
                state_path = project / ".runtime/instance.json"
                deadline = time.monotonic() + 10
                while not state_path.exists() and process.poll() is None and time.monotonic() < deadline:
                    time.sleep(0.05)
                self.assertTrue(state_path.exists(), "Application never became ready")
                original = json.loads(state_path.read_text(encoding="utf-8"))
                self.assertEqual(existing_url(state_path), original["url"])
                duplicate = subprocess.run(command, cwd=temporary, capture_output=True, timeout=12)
                self.assertEqual(duplicate.returncode, 0, duplicate.stdout.decode("utf-8", errors="replace"))
                self.assertIn("уже работает", duplicate.stdout.decode("utf-8"))
                self.assertEqual(json.loads(state_path.read_text(encoding="utf-8")), original)
            finally:
                process.kill()
                process.communicate(timeout=5)
            recovered = subprocess.run(command + ["--check"], cwd=temporary, capture_output=True, timeout=15)
            self.assertEqual(recovered.returncode, 0, recovered.stdout.decode("utf-8", errors="replace"))
            self.assertFalse(state_path.exists())
            self.assertTrue((project / "logs/reika.log").exists())

    def test_missing_asset_fails_with_a_visible_error(self):
        with tempfile.TemporaryDirectory() as temporary:
            project = self.copy_project(temporary)
            next((project / "web/dist/assets").glob("*.js")).unlink()
            result = subprocess.run(
                [sys.executable, "-X", "utf8", str(project / "run.py"), "--check"],
                cwd=temporary, capture_output=True, timeout=10,
            )
            self.assertEqual(result.returncode, 1)
            self.assertIn("Не удалось запустить", result.stdout.decode("utf-8"))
            self.assertFalse((project / ".runtime/instance.json").exists())

    @unittest.skipUnless(os.name == "nt", "Windows BAT integration")
    def test_bat_from_foreign_directory_and_cyrillic_path(self):
        with tempfile.TemporaryDirectory() as temporary:
            project = self.copy_project(temporary)
            command = ('"' + os.environ.get("COMSPEC", "cmd.exe") + '" /d /s /c ""'
                       + str(project / "Reika.bat") + '" --check --no-browser --no-tray"')
            result = subprocess.run(
                command,
                cwd=temporary, capture_output=True, timeout=45, stdin=subprocess.DEVNULL,
            )
            output = (result.stdout + result.stderr).decode("utf-8", errors="replace")
            self.assertEqual(result.returncode, 0, output)
            self.assertIn("Проверка запуска пройдена", output)

    @unittest.skipUnless(os.name == "nt", "Windows tray integration")
    def test_windows_tray_starts_and_stops(self):
        with tempfile.TemporaryDirectory() as temporary:
            runtime = Path(temporary) / "Рэйка трей & (проверка)!"
            runtime.mkdir()
            server = ReikaServer(ROOT / "web", "tray-smoke-test", "tray-smoke-token")
            thread = threading.Thread(target=server.serve_forever)
            process = marker = None
            thread.start()
            try:
                process, marker = start_tray(server, runtime, runtime, 0)
                detail = (runtime / "tray.log").read_text(encoding="utf-8-sig", errors="replace")
                self.assertIsNotNone(process, detail)
                self.assertTrue(server.tray_active, detail)
                time.sleep(2.5)
                self.assertIsNone(process.poll(), detail)
            finally:
                stop_tray(process, marker)
                server.shutdown()
                thread.join(timeout=5)
                server.server_close()
            self.assertFalse(marker.with_suffix(".ready").exists())


if __name__ == "__main__":
    unittest.main()
