import json
import shutil
import tempfile
import unittest
from pathlib import Path

from reika.server import load_assets


ROOT = Path(__file__).resolve().parents[1]


class BuildTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.web = Path(self.temporary.name) / "web"
        shutil.copytree(ROOT / "web/dist", self.web / "dist")
        self.manifest = self.web / "dist/build.json"

    def tearDown(self):
        self.temporary.cleanup()

    def test_tampered_file_is_rejected_before_server_start(self):
        asset = next((self.web / "dist/assets").glob("*.js"))
        asset.write_bytes(asset.read_bytes() + b"\n// changed")
        with self.assertRaisesRegex(RuntimeError, "повреждён"):
            load_assets(self.web)

    def test_manifest_cannot_expose_files_outside_assets(self):
        manifest = json.loads(self.manifest.read_text())
        for name in ("../run.py", "assets/../../secret.js", "/etc/passwd", "assets/file.map"):
            with self.subTest(name=name):
                changed = {**manifest, "files": {**manifest["files"], name: "0" * 64}}
                self.manifest.write_text(json.dumps(changed))
                with self.assertRaisesRegex(RuntimeError, "Недопустимый путь"):
                    load_assets(self.web)

    def test_missing_or_wrong_build_manifest_fails_clearly(self):
        self.manifest.write_text('{"version":"obsolete","files":{}}')
        with self.assertRaisesRegex(RuntimeError, "Версия сборки"):
            load_assets(self.web)
        self.manifest.unlink()
        with self.assertRaisesRegex(RuntimeError, "npm run build"):
            load_assets(self.web)
