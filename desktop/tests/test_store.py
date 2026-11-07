"""Tests for desktop/store.py and desktop/server.py."""

from __future__ import annotations

import errno
import http.client
import json
import urllib.parse
from collections.abc import Generator
from pathlib import Path
from typing import Any

import pytest
from docuteach.config import Settings

from server import BackendServer, bind_loopback, build_app
from store import InstanceLock, Store

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def data_dir(tmp_path: Path) -> Path:
    d = tmp_path / "data"
    d.mkdir()
    return d


@pytest.fixture
def store(data_dir: Path) -> Store:
    return Store(data_dir)


@pytest.fixture
def web_dir(tmp_path: Path) -> Path:
    d = tmp_path / "web"
    d.mkdir()
    index = "<html><head></head><body><h1>DocuTeach</h1></body></html>"
    (d / "index.html").write_text(index, encoding="utf-8")
    return d


@pytest.fixture
def token() -> str:
    return "test-token-abc123"


@pytest.fixture
def server_ctx(
    tmp_path: Path, web_dir: Path, store: Store, token: str
) -> Generator[dict[str, Any], None, None]:
    sock = bind_loopback()
    port = sock.getsockname()[1]
    settings = Settings(data_dir=tmp_path, log_dir=tmp_path / "logs", token=token, port=port)
    srv = BackendServer(build_app(settings, store, web_dir))
    srv.start(sock)
    yield {"server": srv, "port": port, "token": token, "store": store, "web_dir": web_dir}
    srv.stop()


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


# ---------------------------------------------------------------------------
# Store-level tests
# ---------------------------------------------------------------------------


class TestAtomicWrite:
    def test_crash_between_tmp_and_replace_keeps_old_value(
        self, store: Store, data_dir: Path
    ) -> None:
        """Simulated crash in _replace: old content preserved at .bak."""
        key = "docuteach%3Av1%3Adoc%3Adraft"
        store.put(key, "old content", 1)
        path = store.file_for(key)
        assert path.is_file()

        def _raising_replace(src: Path, dst: Path) -> None:
            raise RuntimeError("simulated crash")

        store._replace = _raising_replace  # type: ignore[method-assign]

        with pytest.raises(RuntimeError, match="simulated crash"):
            store.put(key, "new content", 2)

        # The live file must survive the crash unchanged, and .bak holds a copy
        assert json.loads(path.read_text(encoding="utf-8"))["value"] == "old content"
        bak = path.with_name(path.name + ".bak")
        assert bak.is_file()
        data = json.loads(bak.read_text(encoding="utf-8"))
        assert data["value"] == "old content"

    def test_crash_first_write_no_half_file(self, store: Store) -> None:
        """Crash on first write: no .json at main path."""
        key = "freshkey"
        path = store.file_for(key)

        def _raising_replace(src: Path, dst: Path) -> None:
            raise RuntimeError("boom")

        store._replace = _raising_replace  # type: ignore[method-assign]

        with pytest.raises(RuntimeError):
            store.put(key, "val", 1)

        assert not path.is_file()


class TestCorruptFile:
    def test_corrupt_falls_back_to_bak(self, data_dir: Path) -> None:
        key = "lesson"
        path = data_dir / (urllib.parse.quote(key, safe="") + ".json")
        bak = path.with_name(path.name + ".bak")

        path.write_text("THIS IS NOT VALID JSON {{{", encoding="utf-8")
        bak.write_text(json.dumps({"value": "backed up value"}), encoding="utf-8")

        store = Store(data_dir)
        result = store.load_all()

        corrupt_files = [f for f in data_dir.iterdir() if ".corrupt" in f.name]
        assert len(corrupt_files) == 1
        assert not path.is_file()
        assert result[key] == "backed up value"
        assert any("corrupt" in n for n in store.notices)

    def test_corrupt_no_bak_returns_empty(self, data_dir: Path) -> None:
        key = "broken"
        path = data_dir / (urllib.parse.quote(key, safe="") + ".json")
        path.write_text("garbage", encoding="utf-8")

        store = Store(data_dir)
        result = store.load_all()

        corrupt_files = [f for f in data_dir.iterdir() if ".corrupt" in f.name]
        assert len(corrupt_files) == 1
        assert not path.is_file()
        assert result[key] == ""
        assert len(store.notices) == 2


class TestSeq:
    def test_older_seq_put_stale(self, store: Store) -> None:
        store.put("k", "v5", 5)
        assert store.put("k", "v3", 3) == "stale"
        data = json.loads(store.file_for("k").read_text(encoding="utf-8"))
        assert data["value"] == "v5"

    def test_older_seq_delete_stale(self, store: Store) -> None:
        store.put("k", "v5", 5)
        assert store.delete("k", 3) == "stale"
        assert store.file_for("k").is_file()

    def test_new_store_accepts_seq_1(self, data_dir: Path) -> None:
        s1 = Store(data_dir)
        assert s1.put("k", "val5", 5) == "ok"

        s2 = Store(data_dir)
        assert s2.put("k", "val1", 1) == "ok"
        data = json.loads(s2.file_for("k").read_text(encoding="utf-8"))
        assert data["value"] == "val1"


class TestInstanceLock:
    def test_second_lock_refuses(self, tmp_path: Path) -> None:
        lock_path = tmp_path / "DocuTeach" / ".lock"
        l1 = InstanceLock(lock_path)
        assert l1.acquire() is True
        l2 = InstanceLock(lock_path)
        assert l2.acquire() is False
        l1.release()

    def test_reusable_after_release(self, tmp_path: Path) -> None:
        lock_path = tmp_path / ".lock"
        l1 = InstanceLock(lock_path)
        assert l1.acquire() is True
        l1.release()
        l2 = InstanceLock(lock_path)
        assert l2.acquire() is True
        l2.release()


# ---------------------------------------------------------------------------
# Server-level tests (real HTTP, port 0)
# ---------------------------------------------------------------------------


class TestServerAuth:
    def test_missing_token_403(self, server_ctx: dict[str, Any]) -> None:
        port = server_ctx["port"]
        status, _ = _req(port, "GET", "/_store")
        assert status == 403

    def test_wrong_host_403(self, server_ctx: dict[str, Any]) -> None:
        port = server_ctx["port"]
        token = server_ctx["token"]
        status, _ = _req(
            port,
            "GET",
            "/_store",
            headers={"X-DocuTeach-Token": token, "Host": "127.0.0.1:99999"},
        )
        assert status == 403


class TestServerCrud:
    def test_put_get_delete_round_trip(self, server_ctx: dict[str, Any]) -> None:
        port = server_ctx["port"]
        token = server_ctx["token"]
        auth = {"X-DocuTeach-Token": token, "Host": f"127.0.0.1:{port}"}

        # PUT
        body = json.dumps({"value": "hello world", "seq": 1}).encode()
        status, _ = _req(port, "PUT", "/_store/mykey", body=body, headers=auth)
        assert status == 204

        # GET /_store
        status, resp = _req(port, "GET", "/_store", headers=auth)
        assert status == 200
        data = json.loads(resp)
        assert data["mykey"] == "hello world"

        # DELETE
        del_body = json.dumps({"seq": 2}).encode()
        status, _ = _req(port, "DELETE", "/_store/mykey", body=del_body, headers=auth)
        assert status == 204

        # GET /_store again
        status, resp = _req(port, "GET", "/_store", headers=auth)
        data = json.loads(resp)
        assert "mykey" not in data


class TestServerPathTraversal:
    def _setup_secret(self, tmp_path: Path) -> str:
        secret = tmp_path / "secret.txt"
        secret.write_text("TOP-SECRET-CONTENT", encoding="utf-8")
        return "TOP-SECRET-CONTENT"

    def test_encoded_traversal_blocked(
        self, server_ctx: dict[str, Any], tmp_path: Path
    ) -> None:
        secret_content = self._setup_secret(tmp_path)
        port = server_ctx["port"]
        token = server_ctx["token"]
        auth = {"X-DocuTeach-Token": token, "Host": f"127.0.0.1:{port}"}

        for evil_path in ("/..%2f..%2fsecret", "/%2e%2e/x", "/..\\x"):
            status, body = _req(port, "GET", evil_path, headers=auth)
            assert status in (403, 404), f"{evil_path} -> {status}"
            assert secret_content.encode() not in body

    def test_backslash_path_blocked(self, server_ctx: dict[str, Any]) -> None:
        port = server_ctx["port"]
        token = server_ctx["token"]
        auth = {"X-DocuTeach-Token": token, "Host": f"127.0.0.1:{port}"}
        status, _body = _req(port, "GET", "/..\\..\\etc", headers=auth)
        assert status in (403, 404)


class TestServerSeq:
    def test_older_seq_409_put(self, server_ctx: dict[str, Any]) -> None:
        port = server_ctx["port"]
        token = server_ctx["token"]
        auth = {"X-DocuTeach-Token": token, "Host": f"127.0.0.1:{port}"}

        body5 = json.dumps({"value": "newer", "seq": 5}).encode()
        status, _ = _req(port, "PUT", "/_store/k", body=body5, headers=auth)
        assert status == 204

        body3 = json.dumps({"value": "older", "seq": 3}).encode()
        status, _ = _req(port, "PUT", "/_store/k", body=body3, headers=auth)
        assert status == 409

        # File still has "newer"
        store: Store = server_ctx["store"]
        data = json.loads(store.file_for("k").read_text(encoding="utf-8"))
        assert data["value"] == "newer"

    def test_older_seq_409_delete(self, server_ctx: dict[str, Any]) -> None:
        port = server_ctx["port"]
        token = server_ctx["token"]
        auth = {"X-DocuTeach-Token": token, "Host": f"127.0.0.1:{port}"}

        body5 = json.dumps({"value": "keep", "seq": 5}).encode()
        status, _ = _req(port, "PUT", "/_store/k", body=body5, headers=auth)
        assert status == 204

        del_body = json.dumps({"seq": 3}).encode()
        status, _ = _req(port, "DELETE", "/_store/k", body=del_body, headers=auth)
        assert status == 409
        assert store_file_exists(server_ctx["store"], "k")


def store_file_exists(store: Store, key: str) -> bool:
    return store.file_for(key).is_file()


class TestServerNewRun:
    def test_new_store_accepts_seq_1_via_http(self, server_ctx: dict[str, Any]) -> None:
        """Simulate restart: new Store on same dir accepts seq 1."""
        port = server_ctx["port"]
        token = server_ctx["token"]
        auth = {"X-DocuTeach-Token": token, "Host": f"127.0.0.1:{port}"}
        data_dir = server_ctx["store"]._data_dir  # type: ignore[union-attr]

        body5 = json.dumps({"value": "run1", "seq": 5}).encode()
        status, _ = _req(port, "PUT", "/_store/k", body=body5, headers=auth)
        assert status == 204

        # New Store (new run) — swap into a new server is heavy; test at Store level
        new_store = Store(data_dir)
        assert new_store.put("k", "run2", 1) == "ok"


class TestServerTokenMeta:
    def test_token_injected_in_index(self, server_ctx: dict[str, Any]) -> None:
        port = server_ctx["port"]
        token = server_ctx["token"]
        status, body = _req(port, "GET", "/")
        assert status == 200
        html = body.decode("utf-8")
        assert f'<meta name="docuteach-token" content="{token}">' in html


class TestServerEnospc:
    def test_enospc_returns_507(
        self, server_ctx: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        port = server_ctx["port"]
        token = server_ctx["token"]
        auth = {"X-DocuTeach-Token": token, "Host": f"127.0.0.1:{port}"}

        def fake_fsync(fd: int) -> None:
            raise OSError(errno.ENOSPC, "No space left on device")

        monkeypatch.setattr("os.fsync", fake_fsync)

        body = json.dumps({"value": "big", "seq": 1}).encode()
        status, _ = _req(port, "PUT", "/_store/full", body=body, headers=auth)
        assert status == 507
