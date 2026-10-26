"""Windows CI: launch a release ZIP with its own embedded Python."""

import os
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path


def main(archive_path):
    with tempfile.TemporaryDirectory() as temporary:
        destination = Path(temporary) / "Рэйка архив & проверка"
        destination.mkdir()
        with zipfile.ZipFile(archive_path) as archive:
            assert archive.testzip() is None, "Архив повреждён"
            archive.extractall(destination)
        projects = [path for path in destination.iterdir() if path.is_dir()]
        assert len(projects) == 1, "В архиве должна быть одна папка Reika"
        project = projects[0]
        python = project / ".runtime" / "python" / "python.exe"
        assert python.is_file(), "В архиве отсутствует встроенный Python"
        command = (
            f'"{os.environ.get("COMSPEC", "cmd.exe")}" /d /s /c '
            f'""{project / "Reika.bat"}" --check --no-browser --no-tray"'
        )
        result = subprocess.run(
            command, cwd=destination, input=b"\n", capture_output=True, timeout=60
        )
        output = (result.stdout + result.stderr).decode("utf-8", errors="replace")
        assert result.returncode == 0, output
        assert "Проверка запуска пройдена" in output, output
        log = (project / "logs" / "startup.log").read_text(encoding="utf-8-sig")
        assert str(python).lower() in log.lower(), log
        print("Portable release started with embedded Python.")


if __name__ == "__main__":
    if os.name != "nt":
        raise SystemExit("Проверка автономного запуска выполняется в Windows.")
    main(Path(sys.argv[1]))
