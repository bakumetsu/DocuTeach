"""Shared fixtures for DocuTeach backend tests."""

from __future__ import annotations

import socket
from collections.abc import AsyncIterator, Generator
from pathlib import Path
from typing import cast

import httpx
import pytest
from fastapi import FastAPI

from docuteach.app import create_app
from docuteach.config import Settings
from docuteach.store.library import Library


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        data_dir=tmp_path / "data_root",
        log_dir=tmp_path / "logs",
        token="test-token",
        port=0,
    )


@pytest.fixture
def library(settings: Settings) -> Library:
    return Library(settings)


@pytest.fixture(autouse=True)
def block_non_loopback(monkeypatch: pytest.MonkeyPatch) -> Generator[None, None, None]:
    """Ensure no test can open a socket to a non-loopback host."""

    real_create_connection = socket.create_connection

    def _fake_create_connection(*args: object, **kwargs: object) -> socket.socket:  # type: ignore[no-untyped-def]
        target: object = args[0] if args else kwargs.get("host", "")
        host: object = target
        if isinstance(target, tuple):
            host = cast("tuple[object, ...]", target)[0]
        if isinstance(host, str) and host not in ("127.0.0.1", "localhost", "::1"):
            raise RuntimeError(f"non-loopback connection blocked: {host}")
        return real_create_connection(*args, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(socket, "create_connection", _fake_create_connection)
    yield


@pytest.fixture
def app(settings: Settings) -> FastAPI:
    return create_app(settings)


@pytest.fixture
async def client(app: FastAPI, settings: Settings) -> AsyncIterator[httpx.AsyncClient]:
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://127.0.0.1:8765",
            headers={"X-DocuTeach-Token": "test-token"},
        ) as c:
            yield c
