"""Unit tests for docuteach.llm.models and docuteach.llm.slots."""

from __future__ import annotations

from pathlib import Path
from typing import Any, cast
from unittest.mock import MagicMock

import httpx
import pytest

from docuteach.config import Settings
from docuteach.errors import ApiError
from docuteach.llm.client import LlmClient
from docuteach.llm.models import ModelState
from docuteach.llm.overlay import Overlay
from docuteach.llm.slots import SlotTable
from docuteach.llm.stream import LlmService


def _settings(tmp_path: Path, **kw: Any) -> Settings:
    return Settings(data_dir=tmp_path, log_dir=tmp_path, token="t", **kw)


# ── LlmClient.unload ──────────────────────────────────────────────────────


@pytest.mark.anyio
async def test_unload_200(tmp_path: Path) -> None:
    captured: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request.url.path)
        return httpx.Response(200)

    http = httpx.AsyncClient(base_url="http://x", transport=httpx.MockTransport(handler))
    client = LlmClient(_settings(tmp_path), http=http)
    await client.unload("m1")
    assert captured == ["/api/models/unload/m1"]
    await http.aclose()


@pytest.mark.anyio
async def test_unload_404(tmp_path: Path) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404)

    http = httpx.AsyncClient(base_url="http://x", transport=httpx.MockTransport(handler))
    client = LlmClient(_settings(tmp_path), http=http)
    await client.unload("ghost")  # idempotent, must not raise
    await http.aclose()


@pytest.mark.anyio
async def test_unload_500(tmp_path: Path) -> None:
    captured: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request.url.path)
        return httpx.Response(500)

    http = httpx.AsyncClient(base_url="http://x", transport=httpx.MockTransport(handler))
    client = LlmClient(_settings(tmp_path), http=http)
    with pytest.raises(ApiError) as exc_info:
        await client.unload("boom")
    err = exc_info.value
    assert err.code == "unload_failed"
    assert err.status == 502
    assert captured == ["/api/models/unload/boom"]
    await http.aclose()


# ── LlmClient.running_all ─────────────────────────────────────────────────


@pytest.mark.anyio
async def test_running_all_ok(tmp_path: Path) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"running": [{"model": "a", "state": "ready"}]})

    http = httpx.AsyncClient(base_url="http://x", transport=httpx.MockTransport(handler))
    client = LlmClient(_settings(tmp_path), http=http)
    assert await client.running_all() == [("a", "ready")]
    await http.aclose()


@pytest.mark.anyio
async def test_running_all_malformed(tmp_path: Path) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"not-json")

    http = httpx.AsyncClient(base_url="http://x", transport=httpx.MockTransport(handler))
    client = LlmClient(_settings(tmp_path), http=http)
    assert await client.running_all() == []
    await http.aclose()


@pytest.mark.anyio
async def test_running_all_missing_keys(tmp_path: Path) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"running": [{"foo": "bar"}]})

    http = httpx.AsyncClient(base_url="http://x", transport=httpx.MockTransport(handler))
    client = LlmClient(_settings(tmp_path), http=http)
    assert await client.running_all() == []
    await http.aclose()


# ── SlotTable ─────────────────────────────────────────────────────────────


def test_slot_table_assign_clear_reassign() -> None:
    table = SlotTable(2)
    assert table.assign("a") == 0
    assert table.assign("b") == 1
    table.clear()
    assert table.assign("c") == 0
    assert table.take_erase_pending() == []


# ── LlmService.cancel_all ─────────────────────────────────────────────────


@pytest.mark.anyio
async def test_cancel_all(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    mock_client = cast(LlmClient, MagicMock())
    svc = LlmService(settings, mock_client)
    svc._active.add("c1")  # pyright: ignore[reportPrivateUsage]
    await svc.cancel_all()
    assert "c1" in svc._stopped  # pyright: ignore[reportPrivateUsage]
    assert "c1" in svc._unloaded  # pyright: ignore[reportPrivateUsage]
    assert svc.slots.assign("new-chat") == 0


# ── ModelState ────────────────────────────────────────────────────────────


def test_model_state_read_missing_file(tmp_path: Path) -> None:
    ms = ModelState(_settings(tmp_path), Overlay(tmp_path / "overlay.yaml"))
    assert ms.read() == {}


def test_model_state_write_read_roundtrip(tmp_path: Path) -> None:
    ms = ModelState(_settings(tmp_path), Overlay(tmp_path / "overlay.yaml"))
    ms.write(default="m1")
    assert ms.read() == {"default": "m1"}
    ms.write(default=None)
    assert ms.read() == {}


def test_model_state_tolerates_invalid_json(tmp_path: Path) -> None:
    path = tmp_path / "overlay.yaml"
    path.write_text('{"broken": ', encoding="utf-8")
    ms = ModelState(_settings(tmp_path), Overlay(path))
    assert ms.read() == {}


def test_default_id_no_managed(tmp_path: Path) -> None:
    ms = ModelState(_settings(tmp_path, model_allowlist=[]), Overlay(tmp_path / "overlay.yaml"))
    assert ms.default_id() is None


def test_default_id_allowlist_no_state(tmp_path: Path) -> None:
    s = _settings(tmp_path, model_allowlist=["a", "b"])
    ms = ModelState(s, Overlay(tmp_path / "overlay.yaml"))
    assert ms.default_id() == "a"


def test_default_id_state_valid(tmp_path: Path) -> None:
    s = _settings(tmp_path, model_allowlist=["a", "b"])
    ms = ModelState(s, Overlay(tmp_path / "overlay.yaml"))
    ms.write(default="b")
    assert ms.default_id() == "b"


def test_default_id_state_not_managed_falls_back(tmp_path: Path) -> None:
    s = _settings(tmp_path, model_allowlist=["a", "b"])
    ms = ModelState(s, Overlay(tmp_path / "overlay.yaml"))
    ms.write(default="zzz")
    assert ms.default_id() == "a"
