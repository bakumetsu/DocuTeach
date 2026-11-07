"""Tests for backend API endpoints mounted via build_app / BackendServer."""

from __future__ import annotations

import http.client
import json
from pathlib import Path
from typing import Any

from docuteach.config import Settings

from server import BackendServer, bind_loopback, build_app
from store import Store

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _req(
    port: int,
    method: str,
    path: str,
    body: bytes | None = None,
    headers: dict[str, str] | None = None,
) -> tuple[int, bytes]:
    conn = http.client.HTTPConnection("127.0.0.1", port)
    hdrs = dict(headers) if headers else {}
    if body is not None:
        hdrs["Content-Length"] = str(len(body))
    conn.request(method, path, body=body, headers=hdrs)
    resp = conn.getresponse()
    resp_body = resp.read()
    status = resp.status
    conn.close()
    return status, resp_body


def _auth(port: int, token: str) -> dict[str, str]:
    return {"X-DocuTeach-Token": token, "Host": f"127.0.0.1:{port}", "Content-Type": "application/json"}


def start(tmp_path: Path) -> tuple[BackendServer, int]:
    sock = bind_loopback()
    port = sock.getsockname()[1]
    data_dir = tmp_path / "data"
    data_dir.mkdir(exist_ok=True)
    web_dir = tmp_path / "web"
    web_dir.mkdir(exist_ok=True)
    (web_dir / "index.html").write_text(
        "<html><head></head><body>x</body></html>", encoding="utf-8"
    )
    store = Store(data_dir)
    settings = Settings(
        data_dir=tmp_path, log_dir=tmp_path / "logs", token="t0k", port=port
    )
    app = build_app(settings, store, web_dir)
    srv = BackendServer(app)
    srv.start(sock)
    return srv, port


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_status_needs_token(tmp_path: Path) -> None:
    srv, port = start(tmp_path)
    try:
        status, body = _req(port, "GET", "/api/status", headers=_auth(port, "t0k"))
        assert status == 200
        data: dict[str, Any] = json.loads(body)
        assert "version" in data

        status, _ = _req(port, "GET", "/api/status", headers={"Host": f"127.0.0.1:{port}"})
        assert status == 403
    finally:
        srv.stop()


def test_store_still_serves_prefs(tmp_path: Path) -> None:
    srv, port = start(tmp_path)
    try:
        auth = _auth(port, "t0k")

        body = json.dumps({"value": "dark", "seq": 1}).encode()
        status, _ = _req(port, "PUT", "/_store/theme", body=body, headers=auth)
        assert status == 204

        status, resp = _req(port, "GET", "/_store", headers=auth)
        assert status == 200
        data = json.loads(resp)
        assert data["theme"] == "dark"
    finally:
        srv.stop()


def test_lesson_survives_restart(tmp_path: Path) -> None:
    srv, port = start(tmp_path)
    try:
        auth = _auth(port, "t0k")

        body = json.dumps({"title": "Reopen me"}).encode()
        status, resp = _req(port, "POST", "/api/lessons", body=body, headers=auth)
        assert status == 200
        lesson_id: str = json.loads(resp)["id"]

        doc_body = json.dumps({"markdown": "# Reopen me\n\nHello"}).encode()
        status, _ = _req(
            port, "PUT", f"/api/lessons/{lesson_id}/doc", body=doc_body, headers=auth
        )
        assert status == 200
    finally:
        srv.stop()

    # Start a NEW server on the same tmp_path
    srv2, port2 = start(tmp_path)
    try:
        auth2 = _auth(port2, "t0k")
        status, resp = _req(
            port2, "GET", f"/api/lessons/{lesson_id}/doc", headers=auth2
        )
        assert status == 200
        data = json.loads(resp)
        assert data["markdown"] == "# Reopen me\n\nHello"
    finally:
        srv2.stop()


def test_d07_import_runs_on_start(tmp_path: Path) -> None:
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    key_file = data_dir / "docuteach%3Av1%3Adoc%3Adraft.json"
    key_file.write_text(
        json.dumps({
            "value": json.dumps({
                "id": "draft",
                "markdown": "# Old lesson\n\nText",
                "updatedAt": "2026-01-01T00:00:00Z",
            })
        }),
        encoding="utf-8",
    )

    srv, port = start(tmp_path)
    try:
        auth = _auth(port, "t0k")

        status, resp = _req(port, "GET", "/api/lessons", headers=auth)
        assert status == 200
        lessons: list[dict[str, Any]] = json.loads(resp)
        imported = [l for l in lessons if l["id"] == "imported-lesson-d07"]
        assert len(imported) == 1

        status, resp = _req(
            port, "GET", "/api/lessons/imported-lesson-d07/doc", headers=auth
        )
        assert status == 200
        data = json.loads(resp)
        assert data["markdown"] == "# Old lesson\n\nText"
    finally:
        srv.stop()


def test_shutdown_runs_hooks_once(tmp_path: Path) -> None:
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    web_dir = tmp_path / "web"
    web_dir.mkdir()
    (web_dir / "index.html").write_text(
        "<html><head></head><body>x</body></html>", encoding="utf-8"
    )
    store = Store(data_dir)
    settings = Settings(
        data_dir=tmp_path, log_dir=tmp_path / "logs", token="t0k", port=0
    )
    app = build_app(settings, store, web_dir)

    count = 0
    good_ran = False

    def counting_hook() -> None:
        nonlocal count
        count += 1

    def bad_hook() -> None:
        raise RuntimeError("boom")

    def good_hook() -> None:
        nonlocal good_ran
        good_ran = True

    app.state.shutdown_hooks.append(counting_hook)
    app.state.shutdown_hooks.append(bad_hook)
    app.state.shutdown_hooks.append(good_hook)

    app.state.shutdown()
    app.state.shutdown()

    assert count == 1
    assert good_ran is True


def test_static_and_index_token(tmp_path: Path) -> None:
    srv, port = start(tmp_path)
    try:
        status, body = _req(port, "GET", "/")
        assert status == 200
        html = body.decode("utf-8")
        assert '<meta name="docuteach-token" content="t0k">' in html

        status, _ = _req(port, "GET", "/nonexistent.js")
        assert status == 404
    finally:
        srv.stop()


def test_api_stop_twice_safe(tmp_path: Path) -> None:
    srv, _port = start(tmp_path)
    srv.stop()
    srv.stop()


def test_stop_releases_log_file(tmp_path: Path) -> None:
    srv, port = start(tmp_path)
    _req(port, "GET", "/api/status", headers=_auth(port, "t0k"))
    srv.stop()

    log_file = tmp_path / "logs" / "backend.log"
    assert log_file.exists()
    log_file.unlink()
