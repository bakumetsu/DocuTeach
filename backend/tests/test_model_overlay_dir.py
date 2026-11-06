"""Tests for the model overlay directory feature."""

from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
import pytest
import yaml

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


async def test_set_dir_then_add_writes_only_own_file(
    env: tuple[MockLlm, httpx.AsyncClient, Settings], tmp_path: Path
) -> None:
    _mock, client, s = env
    s.data_dir.mkdir(parents=True, exist_ok=True)

    folder = tmp_path / "config.d"
    folder.mkdir(parents=True, exist_ok=True)

    resp = await client.post("/api/models/overlay-dir", json={"path": str(folder)})
    assert resp.status_code == 200

    server_exe = make_server(s.data_dir)
    await client.post("/api/models/server-path", json={"path": str(server_exe)})
    gguf = make_gguf(s.data_dir)
    resp = await client.post(
        "/api/models/custom", json={"id": "overlay-one", "model_path": str(gguf)}
    )
    assert resp.status_code == 200

    files = list(folder.iterdir())
    assert len(files) == 1
    assert files[0].name == "llama-swap-docuteach.yaml"
    assert "overlay-one" in files[0].read_text(encoding="utf-8")

    assert not s.overlay_path.exists()

    resp = await client.get("/api/models/manage")
    assert resp.status_code == 200
    assert resp.json()["overlayDir"] == str(folder)


async def test_remove_last_overwrites_with_empty_models(
    env: tuple[MockLlm, httpx.AsyncClient, Settings], tmp_path: Path
) -> None:
    _mock, client, s = env
    s.data_dir.mkdir(parents=True, exist_ok=True)

    folder = tmp_path / "config.d"
    folder.mkdir(parents=True, exist_ok=True)
    resp = await client.post("/api/models/overlay-dir", json={"path": str(folder)})
    assert resp.status_code == 200

    server_exe = make_server(s.data_dir)
    await client.post("/api/models/server-path", json={"path": str(server_exe)})
    gguf = make_gguf(s.data_dir)
    resp = await client.post(
        "/api/models/custom", json={"id": "overlay-one", "model_path": str(gguf)}
    )
    assert resp.status_code == 200

    resp = await client.delete("/api/models/custom/overlay-one")
    assert resp.status_code == 200

    yaml_file = folder / "llama-swap-docuteach.yaml"
    assert yaml_file.exists()
    assert yaml_file.read_text(encoding="utf-8").strip() == "models: {}"


async def test_history_stays_out_of_folder(
    env: tuple[MockLlm, httpx.AsyncClient, Settings], tmp_path: Path
) -> None:
    _mock, client, s = env
    s.data_dir.mkdir(parents=True, exist_ok=True)

    folder = tmp_path / "config.d"
    folder.mkdir(parents=True, exist_ok=True)
    resp = await client.post("/api/models/overlay-dir", json={"path": str(folder)})
    assert resp.status_code == 200

    server_exe = make_server(s.data_dir)
    await client.post("/api/models/server-path", json={"path": str(server_exe)})
    gguf = make_gguf(s.data_dir)
    resp = await client.post(
        "/api/models/custom", json={"id": "overlay-one", "model_path": str(gguf)}
    )
    assert resp.status_code == 200

    resp = await client.delete("/api/models/custom/overlay-one")
    assert resp.status_code == 200

    # Folder holds only the one yaml file (no .history inside)
    files = list(folder.iterdir())
    assert len(files) == 1
    assert files[0].name == "llama-swap-docuteach.yaml"

    # Data dir has the history file/dir with at least one .yaml
    hist = s.data_dir / "llama-swap-docuteach.yaml.history"
    assert hist.exists()
    yaml_entries = [f for f in hist.iterdir() if f.suffix == ".yaml"] if hist.is_dir() else [hist]
    assert len(yaml_entries) >= 1


async def test_unset_dir_keeps_default_location(
    env: tuple[MockLlm, httpx.AsyncClient, Settings],
) -> None:
    _mock, client, s = env
    s.data_dir.mkdir(parents=True, exist_ok=True)

    server_exe = make_server(s.data_dir)
    await client.post("/api/models/server-path", json={"path": str(server_exe)})
    gguf = make_gguf(s.data_dir)
    resp = await client.post(
        "/api/models/custom", json={"id": "overlay-one", "model_path": str(gguf)}
    )
    assert resp.status_code == 200

    assert s.overlay_path.exists()

    resp = await client.get("/api/models/manage")
    assert resp.status_code == 200
    assert resp.json()["overlayDir"] == ""


async def test_set_dir_adopts_existing_entries(
    env: tuple[MockLlm, httpx.AsyncClient, Settings], tmp_path: Path
) -> None:
    _mock, client, s = env
    s.data_dir.mkdir(parents=True, exist_ok=True)

    server_exe = make_server(s.data_dir)
    await client.post("/api/models/server-path", json={"path": str(server_exe)})
    gguf = make_gguf(s.data_dir)
    resp = await client.post("/api/models/custom", json={"id": "adopted", "model_path": str(gguf)})
    assert resp.status_code == 200
    assert s.overlay_path.exists()

    folder = tmp_path / "config.d"
    folder.mkdir(parents=True, exist_ok=True)
    resp = await client.post("/api/models/overlay-dir", json={"path": str(folder)})
    assert resp.status_code == 200

    yaml_file = folder / "llama-swap-docuteach.yaml"
    assert yaml_file.exists()
    assert "adopted" in yaml_file.read_text(encoding="utf-8")


async def test_bad_dir_rejected(env: tuple[MockLlm, httpx.AsyncClient, Settings]) -> None:
    _mock, client, s = env
    s.data_dir.mkdir(parents=True, exist_ok=True)

    resp = await client.post("/api/models/overlay-dir", json={"path": "/nonexistent/folder"})
    assert resp.status_code == 400
    assert "bad_overlay_dir" in resp.text


async def test_empty_path_clears(
    env: tuple[MockLlm, httpx.AsyncClient, Settings], tmp_path: Path
) -> None:
    _mock, client, s = env
    s.data_dir.mkdir(parents=True, exist_ok=True)

    folder = tmp_path / "config.d"
    folder.mkdir(parents=True, exist_ok=True)
    resp = await client.post("/api/models/overlay-dir", json={"path": str(folder)})
    assert resp.status_code == 200

    resp = await client.post("/api/models/overlay-dir", json={"path": ""})
    assert resp.status_code == 200

    resp = await client.get("/api/models/manage")
    assert resp.status_code == 200
    assert resp.json()["overlayDir"] == ""


async def test_undo_writes_in_folder(
    env: tuple[MockLlm, httpx.AsyncClient, Settings], tmp_path: Path
) -> None:
    _mock, client, s = env
    s.data_dir.mkdir(parents=True, exist_ok=True)

    folder = tmp_path / "config.d"
    folder.mkdir(parents=True, exist_ok=True)
    resp = await client.post("/api/models/overlay-dir", json={"path": str(folder)})
    assert resp.status_code == 200

    server_exe = make_server(s.data_dir)
    await client.post("/api/models/server-path", json={"path": str(server_exe)})
    gguf = make_gguf(s.data_dir)
    resp = await client.post(
        "/api/models/custom", json={"id": "overlay-one", "model_path": str(gguf)}
    )
    assert resp.status_code == 200

    resp = await client.post("/api/models/custom/undo")
    assert resp.status_code == 200

    yaml_file = folder / "llama-swap-docuteach.yaml"
    assert yaml_file.exists()
    data: dict[str, Any] = yaml.safe_load(yaml_file.read_text(encoding="utf-8"))
    assert data.get("models") in ({}, None)

    # No other files created in the folder
    files = list(folder.iterdir())
    assert len(files) == 1
    assert files[0].name == "llama-swap-docuteach.yaml"
