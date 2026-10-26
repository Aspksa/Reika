import tempfile
import unittest
import zipfile
from io import BytesIO
from pathlib import Path

from scripts.package_release import append_python, embedded_python


def runtime_zip(extra=None):
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name in ("python.exe", "python312.dll", "python312.zip", "LICENSE.txt"):
            archive.writestr(name, name.encode())
        archive.writestr("python312._pth", b"python312.zip\r\n.\r\n#import site\r\n")
        if extra:
            archive.writestr(extra, b"unexpected")
    return buffer.getvalue()


class PackageReleaseTests(unittest.TestCase):
    def test_runtime_is_added_under_release_root(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "download.zip"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("Reika-1.2.3/Reika.bat", b"@echo off")
            append_python(path, runtime_zip(), "1.2.3")
            with zipfile.ZipFile(path) as archive:
                self.assertIsNone(archive.testzip())
                self.assertIn("Reika-1.2.3/.runtime/python/python.exe", archive.namelist())
                self.assertIn(b"..\\..", archive.read("Reika-1.2.3/.runtime/python/python312._pth"))
                self.assertIn("Reika-1.2.3/.runtime/python/LICENSE.txt", archive.namelist())

    def test_unexpected_runtime_path_and_wrong_digest_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "download.zip"
            with zipfile.ZipFile(path, "w"):
                pass
            with self.assertRaisesRegex(ValueError, "структура"):
                append_python(path, runtime_zip("../outside"), "1.2.3")
            wrong = Path(temporary) / "wrong.zip"
            wrong.write_bytes(runtime_zip())
            with self.assertRaisesRegex(ValueError, "Контрольная сумма"):
                embedded_python(wrong)
