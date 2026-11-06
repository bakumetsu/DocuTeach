"""Tests for LLM stream stats and usage-include behaviour."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest

from docuteach.config import Settings
from tests.mock_llm import MockLlm, free_port, serve

pytestmark = pytest.mark.anyio


def events(resp: httpx.Response) -> list[dict[str, Any]]:
    """Parse NDJSON lines from a fully-received response body."""
    result: list[dict[str, Any]] = []
    for line in resp.text.splitlines():
        line = line.strip()
        if line:
            result.append(json.loads(line))
    return result


@pytest.fixture
async def stream_env(
    settings: Settings,
) -> AsyncIterator[tuple[MockLlm, httpx.AsyncClient]]:
    mock = MockLlm()
    mock_port = free_port()
    backend_port = free_port()
    async with serve(mock.app, port=mock_port) as mock_url:
        s = settings.model_copy(
            update={"llm_base_url": mock_url, "port": backend_port}
        )
        from docuteach.app import create_app

        app = create_app(s)
        async with serve(app, port=backend_port) as backend_url:
            async with httpx.AsyncClient(
                base_url=backend_url,
                headers={"X-DocuTeach-Token": settings.token},
            ) as c:
                yield mock, c


async def test_stream_emits_stats(
    stream_env: tuple[MockLlm, httpx.AsyncClient],
) -> None:
    mock, client = stream_env
    mock.tokens = ["Hi"]
    body: dict[str, Any] = {
        "chatId": "c1",
        "model": "byteshape",
        "messages": [{"role": "user", "content": "hi"}],
    }
    resp = await client.post("/api/chat/stream", json=body)
    assert resp.status_code == 200
    evs = events(resp)

    stats = [e for e in evs if e["type"] == "stats"]
    assert len(stats) == 1
    st = stats[0]
    assert st["in"] == 1240
    assert st["out"] == 380
    assert st["tps"] in (42.0, 42.1)

    types = [e["type"] for e in evs]
    done_idx = types.index("done")
    stats_idx = types.index("stats")
    assert stats_idx < done_idx
    assert types[-1] == "done"


async def test_stream_sends_include_usage(
    stream_env: tuple[MockLlm, httpx.AsyncClient],
) -> None:
    mock, client = stream_env
    mock.tokens = ["Hi"]
    body: dict[str, Any] = {
        "chatId": "c1",
        "model": "byteshape",
        "messages": [{"role": "user", "content": "hi"}],
    }
    resp = await client.post("/api/chat/stream", json=body)
    assert resp.status_code == 200
    assert mock.last_request is not None
    assert mock.last_request["stream_options"] == {"include_usage": True}
