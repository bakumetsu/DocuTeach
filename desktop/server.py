"""Local HTTP server for the DocuTeach desktop launcher store."""

from __future__ import annotations

import json
import logging
import mimetypes
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, cast

from store import Store, StoreFull

log = logging.getLogger(__name__)

MAX_BODY = 16 * 1024 * 1024  # 16 MB


def make_server(
    web_dir: Path,
    store: Store,
    token: str,
    port: int = 0,
) -> ThreadingHTTPServer:
    """Create and bind a ThreadingHTTPServer on 127.0.0.1:*port*."""

    class _Handler(BaseHTTPRequestHandler):
        # -- auth / helpers ------------------------------------------------

        def _check_auth(self) -> bool:
            if self.headers.get("X-DocuTeach-Token", "") != token:
                self._respond(403, b"forbidden")
                return False
            actual_port = cast(ThreadingHTTPServer, self.server).server_port
            expected_host = f"127.0.0.1:{actual_port}"
            if self.headers.get("Host", "") != expected_host:
                self._respond(403, b"forbidden")
                return False
            return True

        def _respond(self, status: int, body: bytes, ctype: str = "text/plain") -> None:
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if body:
                self.wfile.write(body)

        def _read_body(self) -> bytes | None:
            length = int(self.headers.get("Content-Length", "0"))
            if length > MAX_BODY:
                self._respond(413, b"payload too large")
                return None
            return self.rfile.read(length)

        def _content_type(self, name: str) -> str:
            if name.endswith((".js", ".mjs")):
                return "text/javascript"
            return mimetypes.guess_type(name)[0] or "application/octet-stream"

        # -- GET -----------------------------------------------------------

        def do_GET(self) -> None:
            raw = self.path
            if raw == "/_store" or raw == "/_store/":
                if not self._check_auth():
                    return
                data = store.load_all()
                body = json.dumps(data).encode("utf-8")
                self._respond(200, body, "application/json")
                return
            self._serve_static()

        # -- PUT -----------------------------------------------------------

        def do_PUT(self) -> None:
            raw = self.path
            if not raw.startswith("/_store/"):
                self._respond(404, b"not found")
                return
            if not self._check_auth():
                return
            key = urllib.parse.unquote(raw[len("/_store/"):])
            body = self._read_body()
            if body is None:
                return
            try:
                data = json.loads(body)
            except (json.JSONDecodeError, UnicodeDecodeError):
                self._respond(400, b"bad body")
                return
            if not isinstance(data, dict):
                self._respond(400, b"bad body")
                return
            value: Any = data.get("value")
            seq: Any = data.get("seq")
            if not isinstance(value, str) or not isinstance(seq, int):
                self._respond(400, b"bad body")
                return
            try:
                result = store.put(key, value, seq)
            except StoreFull:
                self._respond(507, b"insufficient storage")
                return
            if result == "stale":
                self._respond(409, b"stale seq")
                return
            self._respond(204, b"")

        # -- DELETE --------------------------------------------------------

        def do_DELETE(self) -> None:
            raw = self.path
            if not raw.startswith("/_store/"):
                self._respond(404, b"not found")
                return
            if not self._check_auth():
                return
            key = urllib.parse.unquote(raw[len("/_store/"):])
            body = self._read_body()
            if body is None:
                return
            try:
                data = json.loads(body)
            except (json.JSONDecodeError, UnicodeDecodeError):
                self._respond(400, b"bad body")
                return
            if not isinstance(data, dict):
                self._respond(400, b"bad body")
                return
            seq: Any = data.get("seq")
            if not isinstance(seq, int):
                self._respond(400, b"bad body")
                return
            try:
                result = store.delete(key, seq)
            except StoreFull:
                self._respond(507, b"insufficient storage")
                return
            if result == "stale":
                self._respond(409, b"stale seq")
                return
            self._respond(204, b"")

        # -- static files --------------------------------------------------

        def _serve_static(self) -> None:
            path = urllib.parse.unquote(self.path)
            if ".." in path or "\\" in path:
                self._respond(403, b"forbidden")
                return
            if path == "/":
                self._serve_index()
                return
            file_path = web_dir / path.lstrip("/")
            try:
                resolved = file_path.resolve()
            except (OSError, ValueError):
                self._respond(404, b"not found")
                return
            try:
                web_resolved = web_dir.resolve()
            except (OSError, ValueError):
                self._respond(404, b"not found")
                return
            if not resolved.is_relative_to(web_resolved):
                self._respond(403, b"forbidden")
                return
            if resolved.is_dir() or not resolved.is_file():
                self._respond(404, b"not found")
                return
            data = resolved.read_bytes()
            self._respond(200, data, self._content_type(resolved.name))

        def _serve_index(self) -> None:
            index_path = web_dir / "index.html"
            if not index_path.is_file():
                self._respond(404, b"not found")
                return
            html = index_path.read_text(encoding="utf-8")
            meta = f'<meta name="docuteach-token" content="{token}">'
            if "<head>" in html:
                html = html.replace("<head>", f"<head>\n{meta}", 1)
            elif "<HEAD>" in html:
                html = html.replace("<HEAD>", f"<HEAD>\n{meta}", 1)
            body = html.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        # -- logging -------------------------------------------------------

        def log_message(self, format: str, *args: Any) -> None:
            log.debug(format, *args)

    server = ThreadingHTTPServer(("127.0.0.1", port), _Handler)
    return server
