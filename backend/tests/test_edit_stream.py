"""Tests for the edit-mode streaming endpoint."""

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


def body(
    blocks: list[tuple[str, str]],
    instruction: str = "fix it",
    *,
    allow: bool = False,
    chat_id: str = "e1",
) -> dict[str, Any]:
    """Build a JSON request body for edit mode."""
    return {
        "chatId": chat_id,
        "model": "byteshape",
        "mode": "edit",
        "edit": {
            "instruction": instruction,
            "scope": "lesson",
            "allowProtected": allow,
            "blocks": [{"id": i, "kind": "x", "md": md, "role": "edit"} for i, md in blocks],
        },
    }


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


async def test_edit_happy(stream_env: tuple[MockLlm, httpx.AsyncClient]) -> None:
    mock, client = stream_env
    answer: str = "I fixed it.\n@@ replace b2 @@\nHello there.\n@@ end @@\n"
    mock.tokens = [p for p in answer.splitlines(keepends=True)]

    resp = await client.post(
        "/api/chat/stream",
        json=body([("b1", "She {{went}} home."), ("b2", "Hello.")]),
    )
    assert resp.status_code == 200
    evs = events(resp)

    token_texts = [e["text"] for e in evs if e["type"] == "token"]
    assert "".join(token_texts) == "I fixed it.\n"

    edits = [e for e in evs if e["type"] == "edit"]
    assert len(edits) == 1
    assert edits[0]["kind"] == "replace"
    assert edits[0]["targets"] == ["b2"]
    assert edits[0]["markdown"] == "Hello there."
    assert edits[0]["flags"] == []
    assert edits[0]["opId"] == "op1"

    done = [e for e in evs if e["type"] == "done"]
    assert len(done) == 1
    assert done[0]["edits"] == 1
    assert done[0]["skipped"] == 0
    assert done[0]["noChange"] == 0
    assert done[0]["largeRewrite"] is False


async def test_edit_skipped(stream_env: tuple[MockLlm, httpx.AsyncClient]) -> None:
    mock, client = stream_env
    b2_md = '::: teacher {tag="CCQ"}\nAsk why.\n:::'
    answer: str = "Replaced.\n@@ replace b2 @@\nNew note.\n@@ end @@\n"
    mock.tokens = [p for p in answer.splitlines(keepends=True)]

    # Lock off -> skipped
    resp = await client.post(
        "/api/chat/stream",
        json=body([("b1", "She {{went}} home."), ("b2", b2_md)]),
    )
    assert resp.status_code == 200
    evs = events(resp)

    skipped = [e for e in evs if e["type"] == "edit_skipped"]
    assert len(skipped) == 1
    assert skipped[0]["code"] == "protected_note"
    assert skipped[0]["header"] == "@@ replace b2 @@"

    done = [e for e in evs if e["type"] == "done"]
    assert done[0]["skipped"] == 1

    for e in evs:
        assert "Ask why" not in json.dumps(e)

    # Lock on (allow=True) -> edit with changes_protected flag
    mock.tokens = [p for p in answer.splitlines(keepends=True)]
    resp2 = await client.post(
        "/api/chat/stream",
        json=body([("b1", "She {{went}} home."), ("b2", b2_md)], allow=True, chat_id="e2"),
    )
    assert resp2.status_code == 200
    evs2 = events(resp2)

    edits = [e for e in evs2 if e["type"] == "edit"]
    assert len(edits) == 1
    assert "changes_protected" in edits[0]["flags"]


async def test_edit_no_change(stream_env: tuple[MockLlm, httpx.AsyncClient]) -> None:
    mock, client = stream_env
    answer: str = "Same.\n@@ replace b2 @@\nHello.\n@@ end @@\n"
    mock.tokens = [p for p in answer.splitlines(keepends=True)]

    resp = await client.post(
        "/api/chat/stream",
        json=body([("b1", "She {{went}} home."), ("b2", "Hello.")]),
    )
    assert resp.status_code == 200
    evs = events(resp)

    assert not any(e["type"] == "edit" for e in evs)

    done = [e for e in evs if e["type"] == "done"]
    assert done[0]["noChange"] == 1


async def test_edit_cut_off_length(stream_env: tuple[MockLlm, httpx.AsyncClient]) -> None:
    mock, client = stream_env
    mock.finish_reason = "length"
    answer: str = "ok\n@@ replace b2 @@\nOne.\n@@ replace b1 @@\nTwo"
    mock.tokens = [p for p in answer.splitlines(keepends=True)]

    resp = await client.post(
        "/api/chat/stream",
        json=body([("b1", "A."), ("b2", "B.")]),
    )
    assert resp.status_code == 200
    evs = events(resp)

    edits = [e for e in evs if e["type"] == "edit"]
    assert len(edits) == 1

    skipped = [e for e in evs if e["type"] == "edit_skipped"]
    assert len(skipped) == 1
    assert skipped[0]["code"] == "cut_off"

    done = [e for e in evs if e["type"] == "done"]
    assert done[0]["edits"] == 1
    assert done[0]["skipped"] == 1


async def test_edit_stop_finish(stream_env: tuple[MockLlm, httpx.AsyncClient]) -> None:
    mock, client = stream_env
    mock.finish_reason = "stop"
    answer: str = "ok\n@@ replace b2 @@\nOne.\n@@ replace b1 @@\nTwo"
    mock.tokens = [p for p in answer.splitlines(keepends=True)]

    resp = await client.post(
        "/api/chat/stream",
        json=body([("b1", "A."), ("b2", "B.")]),
    )
    assert resp.status_code == 200
    evs = events(resp)

    edits = [e for e in evs if e["type"] == "edit"]
    assert len(edits) == 2

    assert not any(e["type"] == "edit_skipped" for e in evs)


async def test_edit_missing_finish_cut(stream_env: tuple[MockLlm, httpx.AsyncClient]) -> None:
    mock, client = stream_env
    mock.send_done = False
    mock.finish_reason = None
    answer: str = "ok\n@@ replace b2 @@\nOne.\n@@ replace b1 @@\nTwo"
    mock.tokens = [p for p in answer.splitlines(keepends=True)]

    resp = await client.post(
        "/api/chat/stream",
        json=body([("b1", "A."), ("b2", "B.")]),
    )
    assert resp.status_code == 200
    evs = events(resp)

    skipped = [e for e in evs if e["type"] == "edit_skipped"]
    assert len(skipped) == 1
    assert skipped[0]["code"] == "cut_off"


async def test_edit_prose_only(stream_env: tuple[MockLlm, httpx.AsyncClient]) -> None:
    mock, client = stream_env
    mock.tokens = ["Nothing to change."]

    resp = await client.post(
        "/api/chat/stream",
        json=body([("b1", "A."), ("b2", "B.")]),
    )
    assert resp.status_code == 200
    evs = events(resp)

    assert any(e["type"] == "token" for e in evs)
    assert not any(e["type"] == "edit" for e in evs)

    done = [e for e in evs if e["type"] == "done"]
    assert done[0]["edits"] == 0


async def test_edit_temperature_and_stateless(
    stream_env: tuple[MockLlm, httpx.AsyncClient],
) -> None:
    mock, client = stream_env
    mock.tokens = ["ok"]

    resp = await client.post(
        "/api/chat/stream",
        json=body([("b1", "A.")], instruction="fix it"),
    )
    assert resp.status_code == 200

    assert mock.last_request is not None
    assert mock.last_request["temperature"] == 0.2
    assert mock.last_request["stop"] == ["@@ end @@"]

    messages: list[dict[str, Any]] = mock.last_request["messages"]
    assert len(messages) == 2
    assert messages[0]["role"] == "system"
    assert messages[1]["role"] == "user"
    user_content: str = messages[1]["content"]
    assert user_content.endswith("fix it")
    assert "```" in user_content


async def test_edit_hides_protected_text(
    stream_env: tuple[MockLlm, httpx.AsyncClient],
) -> None:
    mock, client = stream_env
    note_md = '::: teacher {tag="CCQ"}\nSECRET-NOTE\n:::'
    blocks: list[tuple[str, str]] = [("b1", note_md), ("b2", "Hello.")]

    # Lock off: protected text hidden from prompt
    mock.tokens = ["ok"]
    resp = await client.post("/api/chat/stream", json=body(blocks))
    assert resp.status_code == 200
    assert mock.last_request is not None
    assert "SECRET-NOTE" not in json.dumps(mock.last_request["messages"])

    # Lock on: protected text present
    mock.tokens = ["ok"]
    resp2 = await client.post(
        "/api/chat/stream",
        json=body(blocks, allow=True, chat_id="e2"),
    )
    assert resp2.status_code == 200
    assert mock.last_request is not None
    assert "SECRET-NOTE" in json.dumps(mock.last_request["messages"])


async def test_edit_abort_drops_open_op(
    stream_env: tuple[MockLlm, httpx.AsyncClient],
) -> None:
    mock, client = stream_env
    mock.tokens = ["@@ replace b1 @@\n"] + ["word "] * 200
    mock.delay = 0.05

    payload = body([("b1", "A."), ("b2", "B.")])
    async with client.stream("POST", "/api/chat/stream", json=payload) as resp:
        lines_read = 0
        async for line in resp.aiter_lines():
            if not line.strip():
                continue
            lines_read += 1
            data: dict[str, Any] = json.loads(line)
            if data.get("type") == "status" and data.get("status") == "generating":
                break
            if lines_read >= 3:
                break

    t0 = time.monotonic()
    deadline = t0 + 1.0
    while mock.closed_at is None and time.monotonic() < deadline:
        await asyncio.sleep(0.01)

    assert mock.closed_at is not None
    assert mock.closed_at - t0 < 1.0

    assert mock.emitted < 200
    emitted_snapshot = mock.emitted
    await asyncio.sleep(0.3)
    assert mock.emitted == emitted_snapshot


async def test_edit_log_counts_only(
    stream_env: tuple[MockLlm, httpx.AsyncClient],
    settings: Settings,
) -> None:
    mock, client = stream_env
    answer: str = "fixed\n@@ replace b2 @@\nZEBRA-MARKER\n@@ end @@\n"
    mock.tokens = [p for p in answer.splitlines(keepends=True)]

    resp = await client.post(
        "/api/chat/stream",
        json=body([("b1", "ZEBRA-MARKER"), ("b2", "Hello.")]),
    )
    assert resp.status_code == 200

    log_file = settings.log_dir / "backend.log"
    content = log_file.read_text(encoding="utf-8")
    assert "ZEBRA-MARKER" not in content
    assert "edit done:" in content
    assert "edits=1" in content


async def test_edit_missing_payload(
    stream_env: tuple[MockLlm, httpx.AsyncClient],
) -> None:
    _mock, client = stream_env

    payload: dict[str, Any] = {
        "chatId": "e1",
        "model": "byteshape",
        "mode": "edit",
    }
    resp = await client.post("/api/chat/stream", json=payload)
    assert resp.status_code == 400
    assert "edit_missing" in resp.text


async def test_instruction_reaches_model_prompt(
    stream_env: tuple[MockLlm, httpx.AsyncClient],
) -> None:
    mock, client = stream_env
    mock.tokens = ["Done.\n", "@@ end @@\n"]
    note = "make every verb past tense zq7"

    resp = await client.post(
        "/api/chat/stream",
        json=body([("b1", "She goes home.")], instruction=note),
    )
    assert resp.status_code == 200

    sent = [m for r in mock.requests for m in r.get("messages", []) if m.get("role") == "user"]
    assert any(note in m["content"] for m in sent)


async def test_edit_without_reply_still_gets_a_message(
    stream_env: tuple[MockLlm, httpx.AsyncClient],
) -> None:
    mock, client = stream_env
    mock.tokens = ["@@ end @@\n"]

    resp = await client.post("/api/chat/stream", json=body([("b1", "She goes home.")]))
    assert resp.status_code == 200

    token_texts = [e["text"] for e in events(resp) if e["type"] == "token"]
    assert "".join(token_texts).strip() != ""


async def test_edit_without_reply_but_with_edits_gets_fallback(
    stream_env: tuple[MockLlm, httpx.AsyncClient],
) -> None:
    mock, client = stream_env
    mock.tokens = ["@@ replace b1 @@\nShe went home.\n@@ end @@\n"]

    resp = await client.post("/api/chat/stream", json=body([("b1", "She goes home.")]))
    assert resp.status_code == 200

    token_texts = [e["text"] for e in events(resp) if e["type"] == "token"]
    assert "".join(token_texts) == "The model gave no explanation."
