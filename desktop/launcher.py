"""DocuTeach desktop launcher."""

from __future__ import annotations

import ctypes
import http.client
import json
import logging
import logging.handlers
import os
import secrets
import sys
import tempfile
import threading
import time
import webbrowser
from http.server import ThreadingHTTPServer
from pathlib import Path
from typing import Any

from server import make_server
from store import InstanceLock, Store

try:
    import webview
except ImportError:
    webview = None  # type: ignore[assignment]

DOCUTEACH_HOME_ENV = "DOCUTEACH_HOME"
WEBVIEW2_FORCE_BROWSER_ENV = "DOCUTEACH_FORCE_BROWSER"
WEBVIEW2_REG_SUBKEY = (
    r"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients"
    r"\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
)
WEBVIEW2_ARGS = (
    "--disable-features=msSmartScreenProtection"
    " --disable-background-networking"
    " --disable-component-update"
    " --no-pings"
)
BROWSER_MSG = (
    "DocuTeach opened in your browser because Microsoft WebView2 is not installed."
    " Close this message to stop DocuTeach. WebView2 is free from Microsoft."
)


def _resolve_paths() -> tuple[Path, Path, Path, Path]:
    """Return (data_dir, lock_path, log_path, profile_dir)."""
    home = os.environ.get(DOCUTEACH_HOME_ENV)
    if home:
        base = Path(home)
        return base / "data", base / ".lock", base / "logs" / "launcher.log", base / "webview"
    appdata = Path(os.environ.get("APPDATA", os.path.expanduser("~")))
    local = Path(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")))
    return (
        appdata / "DocuTeach" / "data",
        appdata / "DocuTeach" / ".lock",
        local / "DocuTeach" / "logs" / "launcher.log",
        local / "DocuTeach" / "webview",
    )


def _web_dir() -> Path:
    if hasattr(sys, "_MEIPASS"):  # type: ignore[attr-defined]
        return Path(sys._MEIPASS) / "web"  # type: ignore[attr-defined]
    return Path(__file__).resolve().parent.parent / "frontend" / "dist"


def _setup_logging(log_path: Path) -> None:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    h = logging.handlers.RotatingFileHandler(log_path, maxBytes=1_000_000, backupCount=3)
    h.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    root = logging.getLogger()
    root.setLevel(logging.DEBUG)
    root.addHandler(h)


def webview_installed() -> bool:
    if os.environ.get(WEBVIEW2_FORCE_BROWSER_ENV) == "1":
        return False
    if sys.platform != "win32":
        return False
    import winreg

    for root in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
        try:
            with winreg.OpenKey(root, WEBVIEW2_REG_SUBKEY) as key:
                pv, _ = winreg.QueryValueEx(key, "pv")
                if pv and pv != "0.0.0.0":
                    return True
        except OSError:
            continue
    return False


def _msg_box(title: str, text: str) -> None:
    ctypes.windll.user32.MessageBoxW(None, text, title, 0)  # type: ignore[attr-defined]


def _fatal(message: str, log_path: Path) -> int:
    logging.getLogger(__name__).error(message)
    _msg_box("DocuTeach Error", f"{message}\n\nLog file: {log_path}")
    return 1


def _on_closing(window: Any) -> None:
    try:
        window.evaluate_js("window.__docuteachFlush()")
    except Exception:
        pass
    deadline = time.monotonic() + 3.0
    while time.monotonic() < deadline:
        try:
            if window.evaluate_js("window.__docuteachFlushed===true"):
                return
        except Exception:
            pass
        time.sleep(0.1)


def _run_webview(url: str, profile_dir: Path, log: logging.Logger) -> int:
    if webview is None:
        raise ImportError("pywebview is not installed")
    os.environ["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] = WEBVIEW2_ARGS
    profile_dir.mkdir(parents=True, exist_ok=True)
    window: Any = webview.create_window(
        "DocuTeach", url, width=1400, height=900, min_size=(1000, 650)
    )
    window.events.closing += _on_closing
    webview.start(private_mode=False, storage_path=str(profile_dir))
    return 0


def _run_browser(url: str, server: ThreadingHTTPServer, lock: InstanceLock) -> int:
    webbrowser.open(url)

    def _block() -> None:
        _msg_box("DocuTeach", BROWSER_MSG)

    t = threading.Thread(target=_block, daemon=True)
    t.start()
    t.join()
    server.shutdown()
    server.server_close()
    lock.release()
    return 0


def _selftest() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        os.environ[DOCUTEACH_HOME_ENV] = tmp
        home = Path(tmp)

        web_dir = home / "web"
        web_dir.mkdir()
        (web_dir / "index.html").write_text("<html><head></head><body></body></html>")
        (web_dir / "sample").mkdir()
        (web_dir / "sample" / "lesson.md").write_text("# Test\n")

        data_dir = home / "data"
        data_dir.mkdir()
        store = Store(data_dir)
        token = secrets.token_urlsafe(32)

        server = make_server(web_dir, store, token, port=0)
        port = server.server_port
        host = f"127.0.0.1:{port}"
        t = threading.Thread(target=server.serve_forever, daemon=True)
        t.start()

        try:
            # 1 – GET / contains token meta
            c = http.client.HTTPConnection("127.0.0.1", port)
            c.request("GET", "/")
            r = c.getresponse()
            body = r.read().decode()
            c.close()
            if r.status != 200 or f'content="{token}"' not in body:
                print(f"selftest fail: GET / status={r.status}")
                return 1

            # 2 – GET /sample/lesson.md
            c = http.client.HTTPConnection("127.0.0.1", port)
            c.request("GET", "/sample/lesson.md")
            r = c.getresponse()
            r.read()
            c.close()
            if r.status != 200:
                print(f"selftest fail: GET /sample/lesson.md status={r.status}")
                return 1

            # 3 – PUT then GET round-trip on /_store
            payload = json.dumps({"value": "hello", "seq": 1}).encode()
            c = http.client.HTTPConnection("127.0.0.1", port)
            c.request(
                "PUT", "/_store/testkey", body=payload,
                headers={"X-DocuTeach-Token": token, "Host": host},
            )
            r = c.getresponse()
            r.read()
            if r.status != 204:
                print(f"selftest fail: PUT /_store/testkey status={r.status}")
                return 1
            c.request(
                "GET", "/_store",
                headers={"X-DocuTeach-Token": token, "Host": host},
            )
            r = c.getresponse()
            data = json.loads(r.read().decode())
            c.close()
            if r.status != 200 or data.get("testkey") != "hello":
                print(f"selftest fail: GET /_store round-trip status={r.status}")
                return 1

            # 4 – GET /_store without token -> 403
            c = http.client.HTTPConnection("127.0.0.1", port)
            c.request("GET", "/_store", headers={"Host": host})
            r = c.getresponse()
            r.read()
            c.close()
            if r.status != 403:
                print(f"selftest fail: GET /_store no-token status={r.status}")
                return 1
        finally:
            server.shutdown()
            server.server_close()

    print("selftest ok")
    return 0


def main(argv: list[str]) -> int:
    if "--selftest" in argv:
        return _selftest()

    data_dir, lock_path, log_path, profile_dir = _resolve_paths()
    _setup_logging(log_path)
    log = logging.getLogger(__name__)

    lock = InstanceLock(lock_path)
    if not lock.acquire():
        _msg_box("DocuTeach", "DocuTeach is already open.")
        return 1

    try:
        data_dir.mkdir(parents=True, exist_ok=True)
        probe = data_dir / ".wprobe"
        probe.write_text("x", encoding="utf-8")
        probe.unlink()
    except OSError as e:
        lock.release()
        return _fatal(f"Store directory not writable: {e}", log_path)

    store = Store(data_dir)
    token = secrets.token_urlsafe(32)
    web_dir = _web_dir()

    try:
        server = make_server(web_dir, store, token, port=0)
    except OSError as e:
        lock.release()
        return _fatal(f"Failed to bind server: {e}", log_path)

    port = server.server_port
    url = f"http://127.0.0.1:{port}/"
    threading.Thread(target=server.serve_forever, daemon=True).start()

    rc: int
    if webview_installed():
        try:
            rc = _run_webview(url, profile_dir, log)
        except Exception:
            log.exception("WebView2 path failed, falling back to browser")
            rc = _run_browser(url, server, lock)
            return rc
    else:
        rc = _run_browser(url, server, lock)
        return rc

    server.shutdown()
    server.server_close()
    lock.release()
    return rc


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
