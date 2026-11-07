"""Tests for the fonts API endpoint."""

from __future__ import annotations

from pathlib import Path

import httpx
import pytest

from docuteach.export.fonts import FONTS_DIR


@pytest.mark.anyio
async def test_fonts_open_success(
    client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[Path] = []
    monkeypatch.setattr("docuteach.api.fonts.open_folder", calls.append)
    resp = await client.post("/api/fonts/open")
    assert resp.status_code == 200
    assert resp.json() == {"opened": True}
    assert calls == [FONTS_DIR]


@pytest.mark.anyio
async def test_fonts_open_oserror(
    client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def _raise(path: Path) -> None:
        raise OSError("denied")

    monkeypatch.setattr("docuteach.api.fonts.open_folder", _raise)
    resp = await client.post("/api/fonts/open")
    assert resp.status_code == 500
    assert resp.json()["code"] == "fonts_open_failed"
