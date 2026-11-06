# ruff: noqa: F811
"""Tests for model API edit operations: delete, default, unload, stream cancel."""

from __future__ import annotations

import asyncio
import json
from typing import Any

import httpx
import pytest
import yaml

from docuteach.config import Settings
from tests.mock_llm import MockLlm
from tests.test_model_api import (  # pyright: ignore[reportUnusedImport]
    env,  # noqa: F401  # pyright: ignore[reportUnusedImport]
    make_gguf,
    make_server,
)

pytestmark = pytest.mark.anyio


async def test_09_delete_custom(env: tuple[MockLlm, httpx.AsyncClient, Settings]) -> None:
    _mock, client, s = env
    s.data_dir.mkdir(parents=True, exist_ok=True)
    server_exe = make_server(s.data_dir)
    await client.post("/api/models/server-path", json={"path": str(server_exe)})

    # Add a custom model
    gguf = make_gguf(s.data_dir)
    body: dict[str, Any] = {"id": "mycustom", "model_path": str(gguf)}
    resp = await client.post("/api/models/custom", json=body)
    assert resp.status_code == 200

    # DELETE it -> 200, overlay file still exists with models: {}
    resp = await client.delete("/api/models/custom/mycustom")
    assert resp.status_code == 200
    assert s.overlay_path.exists()
    overlay_data: Any = yaml.safe_load(s.overlay_path.read_text(encoding="utf-8"))
    assert overlay_data["models"] == {}

    # DELETE "byteshape" (allowlisted) -> 404
    resp = await client.delete("/api/models/custom/byteshape")
    assert resp.status_code == 404

    # Add another model, set as default, then delete -> models.json no longer has "default"
    gguf2 = make_gguf(s.data_dir / "m2")
    body2: dict[str, Any] = {"id": "second", "model_path": str(gguf2)}
    resp = await client.post("/api/models/custom", json=body2)
    assert resp.status_code == 200

    resp = await client.post("/api/models/default", json={"id": "second"})
    assert resp.status_code == 200

    resp = await client.delete("/api/models/custom/second")
    assert resp.status_code == 200

    models_json: dict[str, Any] = json.loads(s.models_json_path.read_text(encoding="utf-8"))
    assert "default" not in models_json

    # POST /api/models/custom/undo restores it (GET manage lists it again)
    resp = await client.post("/api/models/custom/undo")
    assert resp.status_code == 200
    resp = await client.get("/api/models/manage")
    data: list[dict[str, Any]] = resp.json()["models"]
    ids: list[str] = [e["id"] for e in data]
    assert "second" in ids


async def test_10_set_default(env: tuple[MockLlm, httpx.AsyncClient, Settings]) -> None:
    _mock, client, s = env
    s.data_dir.mkdir(parents=True, exist_ok=True)
    server_exe = make_server(s.data_dir)
    await client.post("/api/models/server-path", json={"path": str(server_exe)})

    # Unknown id -> 400 model_not_allowed
    resp = await client.post("/api/models/default", json={"id": "nonexistent"})
    assert resp.status_code == 400
    assert "model_not_allowed" in resp.text

    # Add a custom model, set it as default -> 200
    gguf = make_gguf(s.data_dir)
    body: dict[str, Any] = {"id": "mycustom", "model_path": str(gguf)}
    resp = await client.post("/api/models/custom", json=body)
    assert resp.status_code == 200

    resp = await client.post("/api/models/default", json={"id": "mycustom"})
    assert resp.status_code == 200

    # Manage shows isDefault on it
    resp = await client.get("/api/models/manage")
    data: list[dict[str, Any]] = resp.json()["models"]
    entry = next(e for e in data if e["id"] == "mycustom")
    assert entry["isDefault"] is True


async def test_11_unload(env: tuple[MockLlm, httpx.AsyncClient, Settings]) -> None:
    mock, client, _s = env

    # Unload "byteshape" while running -> 200, state unloaded
    mock.running_model = "byteshape"
    mock.running_state = "ready"
    resp = await client.post("/api/models/unload", json={"id": "byteshape"})
    assert resp.status_code == 200
    assert resp.json()["state"] == "unloaded"
    assert mock.unloaded == ["byteshape"]
    assert mock.running_model is None

    # Second call is idempotent (200) and does not reach the server: nothing is running
    resp = await client.post("/api/models/unload", json={"id": "byteshape"})
    assert resp.status_code == 200

    # Unload of "other" (not managed) -> 400, mock.unloaded stays
    resp = await client.post("/api/models/unload", json={"id": "other"})
    assert resp.status_code == 400
    assert "other" not in mock.unloaded

    # Body {} unloads the default
    mock.running_model = "byteshape"
    mock.running_state = "ready"
    resp = await client.post("/api/models/unload", json={})
    assert resp.status_code == 200
    assert mock.unloaded == ["byteshape"] * 2


async def test_12_unload_while_loading(env: tuple[MockLlm, httpx.AsyncClient, Settings]) -> None:
    mock, client, _s = env

    mock.running_state = "starting"
    mock.running_model = "byteshape"
    resp = await client.post("/api/models/unload", json={"id": "byteshape"})
    assert resp.status_code == 409
    assert "llm_busy" in resp.text
    assert mock.unloaded == []


async def test_13_unload_cancels_stream(env: tuple[MockLlm, httpx.AsyncClient, Settings]) -> None:
    mock, client, _s = env

    mock.tokens = ["a"] * 200
    mock.delay = 0.02

    events: list[dict[str, Any]] = []
    first_token = asyncio.Event()

    async def read_stream() -> None:
        async with client.stream(
            "POST",
            "/api/chat/stream",
            json={
                "chatId": "c1",
                "model": "byteshape",
                "messages": [{"role": "user", "content": "hi"}],
            },
        ) as resp:
            async for line in resp.aiter_lines():
                if line.strip():
                    evt = json.loads(line)
                    events.append(evt)
                    if len(events) >= 1:
                        first_token.set()

    task = asyncio.create_task(read_stream())
    await asyncio.wait_for(first_token.wait(), timeout=10.0)

    # Trigger unload while stream is in flight
    resp = await client.post("/api/models/unload", json={"id": "byteshape"})
    assert resp.status_code == 200

    await asyncio.wait_for(task, timeout=10.0)

    error_events = [e for e in events if e.get("code") == "llm_unloaded"]
    assert error_events, f"Expected llm_unloaded error in events, got: {events}"


async def test_14_main_config_never_written(
    env: tuple[MockLlm, httpx.AsyncClient, Settings],
) -> None:
    _mock, client, s = env
    s.data_dir.mkdir(parents=True, exist_ok=True)

    # Create server and gguf OUTSIDE data_dir so they don't pollute the assertion
    bin_dir = s.data_dir.parent / "bin"
    server_exe = make_server(bin_dir)
    await client.post("/api/models/server-path", json={"path": str(server_exe)})

    model_dir = s.data_dir.parent / "models"
    gguf = make_gguf(model_dir)
    body: dict[str, Any] = {"id": "mycustom", "model_path": str(gguf)}
    resp = await client.post("/api/models/custom", json=body)
    assert resp.status_code == 200

    # Only models.json, overlay file, and .history files should exist under data_dir
    files: set[str] = {p.name for p in s.data_dir.rglob("*") if p.is_file()}
    expected: set[str] = {"models.json", s.overlay_path.name}
    for h in s.data_dir.rglob("*.history"):
        if h.is_dir():
            for f in h.iterdir():
                if f.is_file():
                    expected.add(f.name)
    assert files <= expected, f"Unexpected files in data_dir: {files - expected}"


async def test_15_edit_custom_and_undo(env: tuple[MockLlm, httpx.AsyncClient, Settings]) -> None:
    _mock, client, s = env
    s.data_dir.mkdir(parents=True, exist_ok=True)
    server_exe = make_server(s.data_dir)
    await client.post("/api/models/server-path", json={"path": str(server_exe)})
    gguf = make_gguf(s.data_dir)

    body: dict[str, Any] = {"id": "mycustom", "model_path": str(gguf), "ttl": 600}
    assert (await client.post("/api/models/custom", json=body)).status_code == 200
    before = s.overlay_path.read_text(encoding="utf-8")

    # Edit: same id, new ttl; a second add of the same id stays refused
    resp = await client.put("/api/models/custom/mycustom", json={**body, "ttl": 300})
    assert resp.status_code == 200
    after = s.overlay_path.read_text(encoding="utf-8")
    assert after != before
    assert (await client.post("/api/models/custom", json=body)).status_code == 400

    # One Undo restores the previous version
    assert (await client.post("/api/models/custom/undo")).status_code == 200
    assert s.overlay_path.read_text(encoding="utf-8") == before


async def test_16_edit_missing_and_id_mismatch(
    env: tuple[MockLlm, httpx.AsyncClient, Settings],
) -> None:
    _mock, client, s = env
    s.data_dir.mkdir(parents=True, exist_ok=True)
    server_exe = make_server(s.data_dir)
    await client.post("/api/models/server-path", json={"path": str(server_exe)})
    body: dict[str, Any] = {"id": "mycustom", "model_path": str(make_gguf(s.data_dir))}

    resp = await client.put("/api/models/custom/mycustom", json=body)
    assert resp.status_code == 404

    await client.post("/api/models/custom", json=body)
    resp = await client.put("/api/models/custom/mycustom", json={**body, "id": "other-id"})
    assert resp.status_code == 400
