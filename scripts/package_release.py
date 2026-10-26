"""Build the Windows release ZIP with a pinned official embedded Python."""

import argparse
import hashlib
import re
import subprocess
import urllib.request
import zipfile
from io import BytesIO
from pathlib import Path

PYTHON_VERSION = "3.12.10"
PYTHON_ARCHIVE = f"python-{PYTHON_VERSION}-embed-amd64.zip"
PYTHON_URL = f"https://www.python.org/ftp/python/{PYTHON_VERSION}/{PYTHON_ARCHIVE}"
PYTHON_SHA256 = "4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3"
REQUIRED = {"python.exe", "python312.dll", "python312.zip", "python312._pth", "LICENSE.txt"}


def embedded_python(source=None):
    if source:
        raw = Path(source).read_bytes()
    else:
        with urllib.request.urlopen(PYTHON_URL, timeout=60) as response:
            raw = response.read(16 * 1024 * 1024 + 1)
    if len(raw) > 16 * 1024 * 1024 or hashlib.sha256(raw).hexdigest() != PYTHON_SHA256:
        raise ValueError("Контрольная сумма встроенного Python не совпадает с закреплённой.")
    return raw


def append_python(archive_path, runtime, version):
    with zipfile.ZipFile(BytesIO(runtime)) as source:
        members = source.infolist()
        names = {member.filename for member in members}
        if not REQUIRED.issubset(names) or len(names) != len(members):
            raise ValueError("Неполный или неоднозначный архив Python.")
        if any(member.is_dir() or "/" in member.filename or "\\" in member.filename for member in members):
            raise ValueError("Неожиданная структура архива Python.")
        if sum(member.file_size for member in members) > 32 * 1024 * 1024:
            raise ValueError("Архив Python превышает ожидаемый размер.")
        with zipfile.ZipFile(archive_path, "a", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as output:
            prefix = f"Reika-{version}/.runtime/python/"
            for member in members:
                data = source.read(member)
                if member.filename == "python312._pth":
                    # Isolated embedded Python must also see Reika at the ZIP root.
                    data = data.rstrip(b"\r\n") + b"\r\n..\\..\r\n"
                output.writestr(prefix + member.filename, data)
    with zipfile.ZipFile(archive_path) as result:
        if result.testzip() is not None:
            raise ValueError("Повреждён итоговый архив выпуска.")
        expected = prefix + "python.exe"
        if expected not in result.namelist():
            raise ValueError("В итоговом архиве нет Python.")


def package_release(ref, version, output, runtime=None):
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise ValueError("Некорректная версия выпуска.")
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    raw = subprocess.check_output(
        ["git", "archive", "--format=zip", f"--prefix=Reika-{version}/", ref]
    )
    output.write_bytes(raw)
    try:
        append_python(output, embedded_python(runtime), version)
    except Exception:
        output.unlink(missing_ok=True)
        raise
    print(f"Portable Windows release: {output}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ref", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--runtime", help="Проверенный локальный ZIP Python для тестирования")
    arguments = parser.parse_args()
    package_release(arguments.ref, arguments.version, arguments.output, arguments.runtime)
