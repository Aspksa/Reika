import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from reika import project_ai


class ProjectAiTests(unittest.TestCase):
    def test_collect_limits_files_and_excludes_private_locations(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "safe.py").write_text("print('ok')")
            (root / ".env").write_text("secret")
            (root / "logs").mkdir()
            (root / "logs/private.py").write_text("secret")
            snapshot = {"files": {"safe.py": {}, ".env": {}, "logs/private.py": {}},
                        "missing": [], "invalid_links": [], "unowned": [], "ambiguous": [],
                        "version_problem": None, "limit_reached": False}
            with patch.object(project_ai, "inspect", return_value=snapshot):
                files, _ = project_ai.collect(root)
            self.assertEqual([item["path"] for item in files], ["safe.py"])

    def test_review_requires_key_before_network(self):
        class Settings:
            def has_key(self): return False
        with self.assertRaisesRegex(ValueError, "ключ Cloud.ru"):
            project_ai.review(Path("."), Settings(), transport=lambda *a, **k: self.fail("network called"))

    def test_review_sends_only_selected_data(self):
        class Settings:
            def has_key(self): return True
            model = "example/model"
            file = None
        with tempfile.TemporaryDirectory() as tmp:
            settings = Settings()
            settings.file = Path(tmp) / "settings.json"
            settings.file.write_text(json.dumps({"secret": "abcd"}))
            def transport(request, timeout):
                self.assertEqual(timeout, 45)
                self.assertEqual(request.get_header("Authorization"), "Bearer private-key")
                body = json.loads(request.data)
                self.assertIn("safe.py", body["messages"][1]["content"])
                self.assertNotIn("private-key", request.data.decode())
                return io.BytesIO(json.dumps({"choices": [{"message": {"content": "Проверить safe.py"}}]}).encode())
            with patch.object(project_ai, "_protect", return_value=b"private-key"), patch.object(project_ai, "collect", return_value=([{"path":"safe.py","content":"print(1)"}], {"limit_reached": False})):
                result = project_ai.review(Path(tmp), settings, transport)
            self.assertEqual(result["answer"], "Проверить safe.py")
