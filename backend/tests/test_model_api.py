"""Tests for the model management API endpoints."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
import pytest

from docuteach.config import Settings
from tests.mock_llm import MockLlm, free_port, serve

pytestmark = pytest.mark.anyio


def make_server(tmp_path: Path) -> Path:
    """Create a fake llama-server.exe file."""
    tmp_path.mkdir(parents=True, exist_ok=True)
    p = tmp_path / "llama-server.exe"
    p.write_bytes(b"\x00" * 64)
    return p


def make_gguf(tmp_path: Path) -> Path:
    """Create a small m.gguf file with some bytes."""
    tmp_path.mkdir(parents=True, exist_ok=True)
    p = tmp_path / "m.gguf"
    p.write_bytes(b"\x00" * 128)
    return p


@pytest.fixture
async def env(settings: Settings) -> AsyncIterator[tuple[MockLlm, httpx.AsyncClient, Settings]]:
    mock = MockLlm()
    mock_port = free_port()
    backend_port = free_port()
    async with serve(mock.app, port=mock_port) as mock_url:
        s = settings.model_copy(
            update={
                "llm_base_url": mock_url,
                "port": backend_port,
                "model_allowlist": ["byteshape"],
                "llama_server_path": "",
            }
        )
        from docuteach.app import create_app

        app = create_app(s)
        async with serve(app, port=backend_port) as backend_url:
            async with httpx.AsyncClient(
                base_url=backend_url,
                headers={"X-DocuTeach-Token": settings.token},
            ) as c:
                yield mock, c, s


async def test_manage_default(env: tuple[MockLlm, httpx.AsyncClient, Settings]) -> None:
    _mock, client, _s = env

    resp = await client.get("/api/models/manage")
    assert resp.status_code == 200
    data: list[dict[str, Any]] = resp.json()["models"]
    assert len(data) == 1
    entry = data[0]
    assert entry["id"] == "byteshape"
    assert entry["state"] == "unloaded"
    assert entry["isDefault"] is True
    assert entry["source"] == "default"
    ids: list[str] = [e["id"] for e in data]
    assert "other" not in ids


async def test_manage_loaded(env: tuple[MockLlm, httpx.AsyncClient, Settings]) -> None:
    mock, client, _s = env

    mock.running_model = "byteshape"
    mock.running_state = "ready"
    resp = await client.get("/api/models/manage")
    assert resp.status_code == 200
    data: list[dict[str, Any]] = resp.json()["models"]
    assert data[0]["state"] == "loaded"

    mock.running_state = "starting"
    resp = await client.get("/api/models/manage")
    assert resp.status_code == 200
    data = resp.json()["models"]
    assert data[0]["state"] == "loading"


async def test_manage_offline(settings: Settings) -> None:
    dead_port = free_port()
    s = settings.model_copy(
        update={
            "llm_base_url": f"http://127.0.0.1:{dead_port}",
            "model_allowlist": ["byteshape"],
            "llama_server_path": "",
        }
    )
    from docuteach.app import create_app

    app = create_app(s)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://127.0.0.1:8765",
            headers={"X-DocuTeach-Token": settings.token},
        ) as c:
            resp = await c.get("/api/models/manage")
            assert resp.status_code == 200
            data: list[dict[str, Any]] = resp.json()["models"]
            assert data[0]["id"] == "byteshape"
            assert data[0]["state"] == "unknown"


async def test_server_path(env: tuple[MockLlm, httpx.AsyncClient, Settings]) -> None:
    _mock, client, s = env
    s.data_dir.mkdir(parents=True, exist_ok=True)

    # Missing file
    missing = {"path": "/nonexistent/llama-server.exe"}
    resp = await client.post("/api/models/server-path", json=missing)
    assert resp.status_code == 400
    assert "bad_server_path" in resp.text

    # Wrong extension
    bad = s.data_dir / "server.bin"
    bad.write_bytes(b"\x00")
    resp = await client.post("/api/models/server-path", json={"path": str(bad)})
    assert resp.status_code == 400
    assert "bad_server_path" in resp.text

    # Valid fake llama-server.exe
    server_exe = make_server(s.data_dir)
    resp = await client.post("/api/models/server-path", json={"path": str(server_exe)})
    assert resp.status_code == 200
    models_json: dict[str, Any] = json.loads(s.models_json_path.read_text(encoding="utf-8"))
    assert models_json.get("llama_server_path") == str(server_exe)


async def test_preview(env: tuple[MockLlm, httpx.AsyncClient, Settings]) -> None:
    _mock, client, s = env
    s.data_dir.mkdir(parents=True, exist_ok=True)

    # No server path set
    gguf = make_gguf(s.data_dir)
    body: dict[str, Any] = {"id": "mycustom", "model_path": str(gguf)}
    resp = await client.post("/api/models/custom/preview", json=body)
    assert resp.status_code == 400
    assert "llama_server_missing" in resp.text

    # Set server path, then preview
    server_exe = make_server(s.data_dir)
    resp = await client.post("/api/models/server-path", json={"path": str(server_exe)})
    assert resp.status_code == 200

    body = {"id": "mycustom", "model_path": str(gguf)}
    resp = await client.post("/api/models/custom/preview", json=body)
    assert resp.status_code == 200
    text: str = resp.json()["yaml"]
    assert "mycustom" in text
    assert "-m" in text
    assert not s.overlay_path.exists()


async def test_custom_add(env: tuple[MockLlm, httpx.AsyncClient, Settings]) -> None:
    mock, client, s = env
    s.data_dir.mkdir(parents=True, exist_ok=True)

    server_exe = make_server(s.data_dir)
    await client.post("/api/models/server-path", json={"path": str(server_exe)})

    # Directory with a space and a non-ASCII character
    model_dir = s.data_dir / "my modèle dir"
    model_dir.mkdir(parents=True, exist_ok=True)
    gguf = model_dir / "m.gguf"
    gguf.write_bytes(b"\x00" * 128)

    body: dict[str, Any] = {"id": "mycustom", "model_path": str(gguf)}
    resp = await client.post("/api/models/custom", json=body)
    assert resp.status_code == 200
    assert s.overlay_path.exists()

    # manage lists it with source "added"
    resp = await client.get("/api/models/manage")
    assert resp.status_code == 200
    data: list[dict[str, Any]] = resp.json()["models"]
    ids: list[str] = [e["id"] for e in data]
    assert "mycustom" in ids
    entry = next(e for e in data if e["id"] == "mycustom")
    assert entry["source"] == "added"
    assert isinstance(entry["sizeGb"], (int, float))

    # /api/models lists it too (once llama-swap knows it)
    mock.models.append("mycustom")
    resp = await client.get("/api/models")
    assert resp.status_code == 200
    models: list[dict[str, Any]] = resp.json()
    model_ids: list[str] = [m["id"] for m in models]
    assert "mycustom" in model_ids


async def test_custom_duplicate_invalid(env: tuple[MockLlm, httpx.AsyncClient, Settings]) -> None:
    _mock, client, s = env
    s.data_dir.mkdir(parents=True, exist_ok=True)

    server_exe = make_server(s.data_dir)
    await client.post("/api/models/server-path", json={"path": str(server_exe)})

    # Duplicate id (byteshape is already in the allowlist)
    body: dict[str, Any] = {"id": "byteshape", "model_path": str(make_gguf(s.data_dir))}
    resp = await client.post("/api/models/custom", json=body)
    assert resp.status_code == 400
    assert "bad_model_form" in resp.text

    # Invalid id with a space
    body = {"id": "Bad Id", "model_path": str(make_gguf(s.data_dir))}
    resp = await client.post("/api/models/custom", json=body)
    assert resp.status_code == 400


async def test_overlay_invalid_yaml(env: tuple[MockLlm, httpx.AsyncClient, Settings]) -> None:
    _mock, client, s = env
    s.data_dir.mkdir(parents=True, exist_ok=True)

    server_exe = make_server(s.data_dir)
    await client.post("/api/models/server-path", json={"path": str(server_exe)})

    # Write garbage to the overlay file
    s.overlay_path.parent.mkdir(parents=True, exist_ok=True)
    s.overlay_path.write_text("not: [valid: yaml: {{{", encoding="utf-8")

    body: dict[str, Any] = {"id": "mycustom", "model_path": str(make_gguf(s.data_dir))}
    resp = await client.post("/api/models/custom", json=body)
    assert resp.status_code == 409
    assert "overlay_invalid" in resp.text

    # manage still returns 200 (overlay ids treated as empty) and flags the broken file
    resp = await client.get("/api/models/manage")
    assert resp.status_code == 200
    assert resp.json()["overlayError"]
