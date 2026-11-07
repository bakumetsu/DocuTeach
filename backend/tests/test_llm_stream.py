"""Tests for the LLM streaming endpoint using real loopback sockets."""

from __future__ import annotations

import asyncio
import json
import time
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
async def stream_env(settings: Settings) -> AsyncIterator[tuple[MockLlm, httpx.AsyncClient]]:
    mock = MockLlm()
    mock_port = free_port()
    backend_port = free_port()
    async with serve(mock.app, port=mock_port) as mock_url:
        s = settings.model_copy(update={"llm_base_url": mock_url, "port": backend_port})
        from docuteach.app import create_app

        app = create_app(s)
        async with serve(app, port=backend_port) as backend_url:
            async with httpx.AsyncClient(
                base_url=backend_url,
                headers={"X-DocuTeach-Token": settings.token},
            ) as c:
                yield mock, c


async def test_stream_happy_path(stream_env: tuple[MockLlm, httpx.AsyncClient]) -> None:
    mock, client = stream_env
    mock.tokens = ["Hello", " ", "wor", "ld"]
    body = {
        "chatId": "c1",
        "model": "byteshape",
        "messages": [{"role": "user", "content": "hi"}],
    }
    resp = await client.post("/api/chat/stream", json=body)
    assert resp.status_code == 200
    evs = events(resp)

    types = [e["type"] for e in evs]
    assert "status" in types
    statuses = [e["status"] for e in evs if e["type"] == "status"]
    assert "swapping" in statuses
    assert "generating" in statuses

    token_texts = [e["text"] for e in evs if e["type"] == "token"]
    assert len(token_texts) == 4
    assert "".join(token_texts) == "Hello world"

    assert evs[-1]["type"] == "done"
    assert mock.slots_seen == [0]
    assert mock.last_request is not None
    assert "stop" not in mock.last_request


async def test_reasoning_not_forwarded(stream_env: tuple[MockLlm, httpx.AsyncClient]) -> None:
    mock, client = stream_env
    mock.reasoning_tokens = ["think"]
    body = {
        "chatId": "c1",
        "model": "byteshape",
        "messages": [{"role": "user", "content": "hi"}],
    }
    resp = await client.post("/api/chat/stream", json=body)
    assert resp.status_code == 200
    evs = events(resp)

    thinking_count = sum(1 for e in evs if e.get("status") == "thinking")
    assert thinking_count == 1

    for e in evs:
        if e["type"] == "token":
            assert "think" not in e["text"]


async def test_abort_cancels_upstream(stream_env: tuple[MockLlm, httpx.AsyncClient]) -> None:
    mock, client = stream_env
    mock.tokens = ["x"] * 200
    mock.delay = 0.05
    body = {
        "chatId": "c1",
        "model": "byteshape",
        "messages": [{"role": "user", "content": "hi"}],
    }
    async with client.stream("POST", "/api/chat/stream", json=body) as resp:
        tokens_read = 0
        async for line in resp.aiter_lines():
            if not line.strip():
                continue
            data: dict[str, Any] = json.loads(line)
            if data.get("type") == "token":
                tokens_read += 1
                if tokens_read >= 3:
                    break

    t0 = time.monotonic()
    deadline = t0 + 1.0
    while mock.closed_at is None and time.monotonic() < deadline:
        await asyncio.sleep(0.01)

    assert mock.closed_at is not None
    assert mock.closed_at - t0 < 1.0

    emitted_snapshot = mock.emitted
    assert emitted_snapshot < 200
    await asyncio.sleep(0.3)
    assert mock.emitted == emitted_snapshot


async def test_chat_busy(stream_env: tuple[MockLlm, httpx.AsyncClient]) -> None:
    mock, client = stream_env
    mock.tokens = ["x"] * 20
    mock.delay = 0.2
    body1 = {
        "chatId": "c1",
        "model": "byteshape",
        "messages": [{"role": "user", "content": "hi"}],
    }
    body2 = {
        "chatId": "c1",
        "model": "byteshape",
        "messages": [{"role": "user", "content": "again"}],
    }
    async with client.stream("POST", "/api/chat/stream", json=body1) as resp1:
        # Wait until at least one token arrives so the chat is actively generating
        async for line in resp1.aiter_lines():
            if not line.strip():
                continue
            data: dict[str, Any] = json.loads(line)
            if data.get("type") == "token":
                break

        resp2 = await client.post("/api/chat/stream", json=body2)
        assert resp2.status_code == 409
        assert "chat_busy" in resp2.text


async def test_offline(settings: Settings) -> None:
    dead_port = free_port()
    backend_port = free_port()
    s = settings.model_copy(
        update={"llm_base_url": f"http://127.0.0.1:{dead_port}", "port": backend_port}
    )
    from docuteach.app import create_app

    app = create_app(s)
    async with serve(app, port=backend_port) as backend_url:
        async with httpx.AsyncClient(
            base_url=backend_url,
            headers={"X-DocuTeach-Token": settings.token},
        ) as c:
            body = {
                "chatId": "c1",
                "model": "byteshape",
                "messages": [{"role": "user", "content": "hi"}],
            }
            resp = await c.post("/api/chat/stream", json=body)
            assert resp.status_code == 200
            evs = events(resp)
            err = [e for e in evs if e["type"] == "error"]
            assert len(err) == 1
            assert err[0]["code"] == "llm_offline"

            status_resp = await c.get("/api/status")
            assert status_resp.status_code == 200
            assert status_resp.json()["llm"] == "offline"

            models_resp = await c.get("/api/models")
            assert models_resp.status_code == 503
            assert "llm_offline" in models_resp.text


async def test_busy_503(stream_env: tuple[MockLlm, httpx.AsyncClient]) -> None:
    mock, client = stream_env
    mock.chat_status = 503
    body = {
        "chatId": "c1",
        "model": "byteshape",
        "messages": [{"role": "user", "content": "hi"}],
    }
    resp = await client.post("/api/chat/stream", json=body)
    assert resp.status_code == 200
    evs = events(resp)
    err = [e for e in evs if e["type"] == "error"]
    assert len(err) == 1
    assert err[0]["code"] == "llm_busy"


async def test_skill_valid_structured(
    stream_env: tuple[MockLlm, httpx.AsyncClient],
) -> None:
    mock, client = stream_env
    mock.tokens = ['::: teacher {tag="CCQ"}\n', "What is it?\n", ":::"]
    body = {
        "chatId": "c1",
        "model": "byteshape",
        "skill": "/ccq",
        "messages": [{"role": "user", "content": "hi"}],
    }
    resp = await client.post("/api/chat/stream", json=body)
    assert resp.status_code == 200
    evs = events(resp)

    structured = [e for e in evs if e["type"] == "structured"]
    assert len(structured) == 1
    assert structured[0]["kind"] == "teacherNote"

    done = [e for e in evs if e["type"] == "done"]
    assert len(done) == 1
    assert "fallback" not in done[0]


async def test_skill_invalid_falls_back(
    stream_env: tuple[MockLlm, httpx.AsyncClient],
) -> None:
    mock, client = stream_env

    # Invalid output with skill: no structured, done has fallback
    mock.tokens = ["just text"]
    body = {
        "chatId": "c1",
        "model": "byteshape",
        "skill": "/ccq",
        "messages": [{"role": "user", "content": "hi"}],
    }
    resp = await client.post("/api/chat/stream", json=body)
    assert resp.status_code == 200
    evs = events(resp)
    assert not any(e["type"] == "structured" for e in evs)
    done = [e for e in evs if e["type"] == "done"]
    assert done[0]["fallback"] == "text"

    # Free chat never emits structured even with valid note text
    mock.tokens = ['::: teacher {tag="CCQ"}\n', "What is it?\n", ":::"]
    body2 = {
        "chatId": "c2",
        "model": "byteshape",
        "messages": [{"role": "user", "content": "hi"}],
    }
    resp2 = await client.post("/api/chat/stream", json=body2)
    assert resp2.status_code == 200
    evs2 = events(resp2)
    assert not any(e["type"] == "structured" for e in evs2)


async def test_idle_timeout(settings: Settings) -> None:
    mock = MockLlm()
    mock.tokens = ["a", "b"]
    mock.delay = 3.0
    mock_port = free_port()
    backend_port = free_port()
    async with serve(mock.app, port=mock_port) as mock_url:
        s = settings.model_copy(
            update={
                "llm_base_url": mock_url,
                "port": backend_port,
                "idle_token_timeout_s": 1,
            }
        )
        from docuteach.app import create_app

        app = create_app(s)
        async with serve(app, port=backend_port) as backend_url:
            async with httpx.AsyncClient(
                base_url=backend_url,
                headers={"X-DocuTeach-Token": settings.token},
            ) as c:
                body = {
                    "chatId": "c1",
                    "model": "byteshape",
                    "messages": [{"role": "user", "content": "hi"}],
                }
                resp = await c.post("/api/chat/stream", json=body)
                assert resp.status_code == 200
                evs = events(resp)
                err = [e for e in evs if e["type"] == "error"]
                assert len(err) == 1
                assert err[0]["code"] == "llm_timeout"


async def test_models_list_select(
    stream_env: tuple[MockLlm, httpx.AsyncClient],
    settings: Settings,
) -> None:
    mock, client = stream_env

    # Default: only allowlisted model, sizeGb 0
    resp = await client.get("/api/models")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["id"] == "byteshape"
    assert data[0]["sizeGb"] == 0

    # Current model is null before any select
    resp = await client.get("/api/models/current")
    assert resp.status_code == 200
    assert resp.json() is None

    # Select byteshape -> ready
    resp = await client.post("/api/models/select", json={"id": "byteshape"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "ready"

    # Current model is "byteshape" after select
    resp = await client.get("/api/models/current")
    assert resp.status_code == 200
    assert resp.json() == "byteshape"

    # Select not-allowed model -> 400
    resp = await client.post("/api/models/select", json={"id": "other"})
    assert resp.status_code == 400

    # Load failure -> status failed with error
    mock.load_status = 500
    resp = await client.post("/api/models/select", json={"id": "byteshape"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "failed"
    assert body["error"] == "load error"

    # allow_all_models: both models visible
    mock2 = MockLlm()
    mock2_port = free_port()
    backend_port2 = free_port()
    async with serve(mock2.app, port=mock2_port) as mock_url:
        s = settings.model_copy(
            update={
                "llm_base_url": mock_url,
                "port": backend_port2,
                "allow_all_models": True,
            }
        )
        from docuteach.app import create_app

        app2 = create_app(s)
        async with serve(app2, port=backend_port2) as backend_url:
            async with httpx.AsyncClient(
                base_url=backend_url,
                headers={"X-DocuTeach-Token": settings.token},
            ) as c:
                resp = await c.get("/api/models")
                assert resp.status_code == 200
                ids = [m["id"] for m in resp.json()]
                assert "byteshape" in ids
                assert "other" in ids


async def test_skills_list(stream_env: tuple[MockLlm, httpx.AsyncClient]) -> None:
    _mock, client = stream_env

    resp = await client.get("/api/skills")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 3
    for s in data:
        assert s["status"] == "active"
        assert s.get("insertAs")

    # Unknown skill in stream -> 400 skill_unknown
    body = {
        "chatId": "c1",
        "model": "byteshape",
        "skill": "/homework",
        "messages": [{"role": "user", "content": "hi"}],
    }
    resp = await client.post("/api/chat/stream", json=body)
    assert resp.status_code == 400
    assert "skill_unknown" in resp.text


async def test_release(stream_env: tuple[MockLlm, httpx.AsyncClient]) -> None:
    mock, client = stream_env

    body = {
        "chatId": "c1",
        "model": "byteshape",
        "messages": [{"role": "user", "content": "hi"}],
    }
    resp = await client.post("/api/chat/stream", json=body)
    assert resp.status_code == 200

    # Release (idempotent: 200 twice)
    resp = await client.post("/api/chats/c1/release")
    assert resp.status_code == 200
    resp = await client.post("/api/chats/c1/release")
    assert resp.status_code == 200

    # Slot was erased
    assert 0 in mock.erased


async def test_log_has_no_text(
    stream_env: tuple[MockLlm, httpx.AsyncClient],
    settings: Settings,
) -> None:
    mock, client = stream_env
    mock.tokens = ["ZEBRA-MARKER"]
    body = {
        "chatId": "c1",
        "model": "byteshape",
        "messages": [{"role": "user", "content": "ZEBRA-MARKER"}],
    }
    resp = await client.post("/api/chat/stream", json=body)
    assert resp.status_code == 200

    log_file = settings.log_dir / "backend.log"
    if log_file.exists():
        content = log_file.read_text(encoding="utf-8")
        assert "ZEBRA-MARKER" not in content


async def test_prompt_too_long(settings: Settings) -> None:
    mock = MockLlm()
    mock.running_model = None
    mock_port = free_port()
    backend_port = free_port()
    async with serve(mock.app, port=mock_port) as mock_url:
        s = settings.model_copy(
            update={
                "llm_base_url": mock_url,
                "port": backend_port,
                "max_prompt_chars": 50,
            }
        )
        from docuteach.app import create_app

        app = create_app(s)
        async with serve(app, port=backend_port) as backend_url:
            async with httpx.AsyncClient(
                base_url=backend_url,
                headers={"X-DocuTeach-Token": settings.token},
            ) as c:
                body = {
                    "chatId": "c1",
                    "model": "byteshape",
                    "messages": [{"role": "user", "content": "A" * 500}],
                }
                resp = await c.post("/api/chat/stream", json=body)
                assert resp.status_code == 413
                assert "prompt_too_long" in resp.text


async def test_model_context_props(
    stream_env: tuple[MockLlm, httpx.AsyncClient],
    settings: Settings,
) -> None:
    mock, client = stream_env

    # Fill the props cache via a real stream (as production does)
    body = {
        "chatId": "c1",
        "model": "byteshape",
        "messages": [{"role": "user", "content": "hi"}],
    }
    resp = await client.post("/api/chat/stream", json=body)
    assert resp.status_code == 200

    # Now the context route reads from the populated cache
    resp = await client.get("/api/models/byteshape/context")
    assert resp.status_code == 200
    data = resp.json()
    expected_nctx = mock.n_ctx // mock.total_slots
    expected_cap = max(0, (expected_nctx - settings.max_answer_tokens) * 3)
    assert data["nCtx"] == expected_nctx
    assert data["promptCapChars"] == expected_cap
    assert data["estimated"] is True


async def test_model_context_never_calls_upstream(
    stream_env: tuple[MockLlm, httpx.AsyncClient],
    settings: Settings,
) -> None:
    mock, client = stream_env

    # Cold cache: no stream has been done yet
    assert mock.props_calls == 0

    resp = await client.get("/api/models/byteshape/context")
    assert resp.status_code == 200
    data = resp.json()
    assert data["nCtx"] is None
    assert data["promptCapChars"] == settings.max_prompt_chars
    assert data["estimated"] is True

    # The mock LLM must NOT have received a props request
    assert mock.props_calls == 0


async def test_model_context_fallback(settings: Settings) -> None:
    dead_port = free_port()
    backend_port = free_port()
    s = settings.model_copy(
        update={"llm_base_url": f"http://127.0.0.1:{dead_port}", "port": backend_port}
    )
    from docuteach.app import create_app

    app = create_app(s)
    async with serve(app, port=backend_port) as backend_url:
        async with httpx.AsyncClient(
            base_url=backend_url,
            headers={"X-DocuTeach-Token": settings.token},
        ) as c:
            resp = await c.get("/api/models/byteshape/context")
            assert resp.status_code == 200
            data = resp.json()
            assert data["nCtx"] is None
            assert data["promptCapChars"] == settings.max_prompt_chars
            assert data["estimated"] is True


# --- more tests ---
