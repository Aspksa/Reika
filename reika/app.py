"""Application lifecycle, single-instance locking, logging and tray supervision."""

from __future__ import annotations

import argparse
import ctypes
import http.client
import json
import logging
import os
import secrets
import signal
import subprocess
import sys
import threading
import time
import uuid
import webbrowser
from logging.handlers import RotatingFileHandler
from pathlib import Path
from urllib.parse import urlsplit

from .server import ReikaServer
from . import __version__


ROOT = Path(__file__).resolve().parent.parent
LOGGER = logging.getLogger("reika")


class InstanceLock:
    """An OS-owned lock, released even when a process is forcibly terminated."""

    def __init__(self, path: Path):
        self.file = path.open("a+b")
        self.acquired = False

    def acquire(self) -> bool:
        if os.name == "nt":
            import msvcrt

            self.file.seek(0, os.SEEK_END)
            if self.file.tell() == 0:
                self.file.write(b"0")
                self.file.flush()
            self.file.seek(0)
            try:
                msvcrt.locking(self.file.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError:
                return False
        else:
            import fcntl

            try:
                fcntl.flock(self.file, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                return False
        self.acquired = True
        return True

    def close(self):
        if self.acquired:
            if os.name == "nt":
                import msvcrt

                self.file.seek(0)
                msvcrt.locking(self.file.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(self.file, fcntl.LOCK_UN)
        self.file.close()


def configure_logging(log_dir: Path, diagnostics: bool):
    log_dir.mkdir(parents=True, exist_ok=True)
    handler = RotatingFileHandler(
        log_dir / "reika.log", maxBytes=2_000_000, backupCount=3, encoding="utf-8"
    )
    formatter = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    handler.setFormatter(formatter)
    console = logging.StreamHandler(sys.stdout)
    console.setFormatter(logging.Formatter("%(message)s"))
    LOGGER.handlers[:] = [handler, console]
    LOGGER.setLevel(logging.DEBUG if diagnostics else logging.INFO)
    LOGGER.propagate = False


def console_handle() -> int:
    if os.name != "nt":
        return 0
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.GetConsoleWindow.restype = ctypes.c_void_p
    return kernel.GetConsoleWindow() or 0


def show_console(handle: int, show: bool):
    if not handle or os.name != "nt":
        return
    user = ctypes.WinDLL("user32", use_last_error=True)
    user.ShowWindow.argtypes = [ctypes.c_void_p, ctypes.c_int]
    user.ShowWindow(handle, 9 if show else 0)


def open_browser(url: str):
    try:
        if not webbrowser.open(url, new=2):
            LOGGER.warning("Браузер не открылся. Откройте адрес вручную: %s", url)
    except Exception:
        LOGGER.warning("Браузер не открылся. Откройте адрес вручную: %s", url)


def write_instance(path: Path, payload: dict):
    temporary = path.with_name(f"{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        with temporary.open("x", encoding="utf-8") as output:
            json.dump(payload, output, ensure_ascii=False)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def existing_url(state_path: Path, wait_seconds: float = 5) -> str | None:
    deadline = time.monotonic() + wait_seconds
    while time.monotonic() < deadline:
        connection = None
        try:
            state = json.loads(state_path.read_text(encoding="utf-8"))
            if not isinstance(state, dict) or not isinstance(state.get("url"), str):
                raise ValueError("Invalid instance state")
            address = urlsplit(state["url"])
            if (
                address.scheme != "http"
                or address.hostname != "127.0.0.1"
                or address.username is not None
                or address.password is not None
                or address.path or address.query or address.fragment
                or not address.port
            ):
                raise ValueError("Invalid local address")
            connection = http.client.HTTPConnection("127.0.0.1", address.port, timeout=0.5)
            connection.request("GET", "/api/status")
            response = connection.getresponse()
            payload = json.loads(response.read(8192))
            if (
                response.status == 200 and payload.get("app") == "Reika"
                and payload.get("instance_id") == state["instance_id"]
            ):
                return state["url"]
        except (OSError, ValueError, KeyError, TypeError, http.client.HTTPException):
            pass
        finally:
            if connection:
                connection.close()
        time.sleep(0.1)
    return None


def start_tray(server: ReikaServer, runtime: Path, logs: Path, handle: int):
    if os.name != "nt":
        return None, None
    powershell = Path(os.environ.get("SystemRoot", r"C:\Windows")) / (
        "System32/WindowsPowerShell/v1.0/powershell.exe"
    )
    marker = runtime / f"tray-{server.instance_id}"
    environment = os.environ.copy()
    environment.update({
        "REIKA_URL": server.url,
        "REIKA_CONTROL_TOKEN": server.control_token,
        "REIKA_INSTANCE_ID": server.instance_id,
        "REIKA_CONSOLE_HANDLE": str(handle),
        "REIKA_VERSION": __version__,
    })
    with (logs / "tray.log").open("ab") as output:
        process = subprocess.Popen(
            [str(powershell), "-NoProfile", "-NonInteractive", "-STA",
             "-ExecutionPolicy", "Bypass", "-File", str(ROOT / "scripts/tray.ps1"),
             "-MarkerPath", str(marker), "-LogsPath", str(logs)],
            cwd=str(ROOT), env=environment, stdout=output, stderr=subprocess.STDOUT,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline and process.poll() is None:
        if marker.with_suffix(".ready").exists():
            server.tray_active = True
            return process, marker
        time.sleep(0.1)
    LOGGER.warning("Значок в трее не появился. Консоль остаётся открытой; журнал: logs/tray.log")
    if process.poll() is None:
        process.terminate()
        process.wait(timeout=5)
    return None, marker


def stop_tray(process, marker):
    if marker:
        marker.with_suffix(".stop").touch()
    if process is not None and process.poll() is None:
        try:
            process.wait(timeout=4)
        except subprocess.TimeoutExpired:
            process.terminate()
            process.wait(timeout=5)
    if marker:
        for suffix in (".ready", ".stop"):
            marker.with_suffix(suffix).unlink(missing_ok=True)


def main(argv=None) -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="backslashreplace")
    parser = argparse.ArgumentParser(description="Рэйка Амацухара — локальное пространство.")
    parser.add_argument("--diagnostics", action="store_true", help="Подробный журнал; консоль остаётся открытой.")
    parser.add_argument("--no-browser", action="store_true", help="Не открывать браузер.")
    parser.add_argument("--no-tray", action="store_true", help="Работать в консоли без значка в трее.")
    parser.add_argument("--check", action="store_true", help="Проверить запуск и завершить работу.")
    options = parser.parse_args(argv)
    runtime = ROOT / ".runtime"
    logs = ROOT / "logs"
    lock = server = thread = tray = marker = None
    state_path = runtime / "instance.json"
    handle = console_handle()
    old_signals = {}
    exit_code = 0
    try:
        runtime.mkdir(parents=True, exist_ok=True)
        lock = InstanceLock(runtime / "instance.lock")
        if not lock.acquire():
            url = existing_url(state_path)
            if not url:
                raise RuntimeError("Reika ещё запускается или не отвечает. Повторите запуск через несколько секунд.")
            print(f"Reika уже работает: {url}")
            if not options.no_browser and not options.check:
                open_browser(url)
            return 0
        configure_logging(logs, options.diagnostics)
        LOGGER.info("✦ Рэйка Амацухара · Reika %s", __version__)
        LOGGER.info("◈ Python %s · %s", sys.version.split()[0], sys.platform)
        server = ReikaServer(ROOT / "web", uuid.uuid4().hex, secrets.token_urlsafe(32))
        thread = threading.Thread(target=server.serve_forever, name="reika-http", daemon=True)
        thread.start()
        write_instance(state_path, {"url": server.url, "pid": os.getpid(), "instance_id": server.instance_id})
        if existing_url(state_path, wait_seconds=2) != server.url:
            raise RuntimeError("Сервер запустился, но проверка соединения не прошла.")
        LOGGER.info("✓ Reika готова: %s", server.url)
        LOGGER.info("Журнал: logs/reika.log · Завершение: меню в трее или Ctrl+C")
        if options.check:
            LOGGER.info("✓ Проверка запуска пройдена.")
            return 0
        for signum in (signal.SIGINT, signal.SIGTERM):
            old_signals[signum] = signal.signal(signum, lambda *_: server.stop_requested.set())
        if not options.no_tray:
            try:
                tray, marker = start_tray(server, runtime, logs, handle)
            except OSError:
                LOGGER.exception("Не удалось запустить трей. Reika продолжает работу в консоли.")
            if os.name == "nt" and server.tray_active and not options.diagnostics:
                show_console(handle, False)
        if not options.no_browser:
            open_browser(server.url)
        while not server.stop_requested.wait(0.5):
            if not thread.is_alive():
                raise RuntimeError("Локальный сервер неожиданно остановился.")
            if tray is not None and tray.poll() is not None:
                tray = None
                server.tray_active = False
                show_console(handle, True)
                LOGGER.warning("Трей завершился. Reika работает; для выхода нажмите Ctrl+C.")
    except KeyboardInterrupt:
        pass
    except Exception as error:
        show_console(handle, True)
        LOGGER.exception("✕ Не удалось запустить Reika: %s", error)
        if not LOGGER.handlers:
            print(f"Ошибка: {error}", file=sys.stderr)
        exit_code = 1
    finally:
        show_console(handle, True)
        if server is not None:
            server.stop_requested.set()
            if thread is not None and thread.is_alive():
                server.shutdown()
                thread.join(timeout=4)
            server.server_close()
            state_path.unlink(missing_ok=True)
        try:
            stop_tray(tray, marker)
        finally:
            if lock is not None:
                lock.close()
        for signum, previous in old_signals.items():
            signal.signal(signum, previous)
    return exit_code
