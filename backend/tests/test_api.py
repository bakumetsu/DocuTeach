"""API tests for DocuTeach, exercised through the shared httpx client."""

from __future__ import annotations

import logging
from typing import Any, cast

import httpx
import pytest
from fastapi import FastAPI

from docuteach.app import create_app
from docuteach.config import Settings


def _json(resp: httpx.Response) -> dict[str, Any]:
    return cast(dict[str, Any], resp.json())


def _json_list(resp: httpx.Response) -> list[Any]:
    return cast(list[Any], resp.json())


async def _unauth_client(app: FastAPI, **headers: str) -> httpx.AsyncClient:
    transport = httpx.ASGITransport(app=app)
    return httpx.AsyncClient(transport=transport, base_url="http://127.0.0.1:8765", headers=headers)


@pytest.mark.anyio
async def test_lesson_flow(client: httpx.AsyncClient) -> None:
    resp = await client.post("/api/lessons", json={"title": "T"})
    assert resp.status_code == 200
    lid = str(_json(resp)["id"])

    resp = await client.get("/api/lessons")
    assert resp.status_code == 200
    assert lid in [str(c["id"]) for c in _json_list(resp)]

    resp = await client.patch(f"/api/lessons/{lid}", json={"title": "T2"})
    assert resp.status_code == 200
    assert _json(resp)["title"] == "T2"

    resp = await client.get(f"/api/lessons/{lid}/doc")
    assert resp.status_code == 200
    assert {"id", "markdown", "updatedAt"} <= set(_json(resp))

    resp = await client.put(f"/api/lessons/{lid}/doc", json={"markdown": "# hello"})
    assert resp.status_code == 200
    assert _json(resp)["markdown"] == "# hello"
    assert "updatedAt" in _json(resp)

    resp = await client.post(
        f"/api/lessons/{lid}/checkpoints", json={"name": "c1", "markdown": "md1"}
    )
    assert resp.status_code in (200, 201)  # create: 201 (or 200)
    cid = str(_json(resp)["id"])

    resp = await client.get(f"/api/lessons/{lid}/checkpoints")
    assert resp.status_code == 200
    assert cid in [str(c["id"]) for c in _json_list(resp)]

    assert (await client.delete(f"/api/lessons/{lid}/checkpoints/{cid}")).status_code == 200
    assert (await client.post(f"/api/lessons/{lid}/checkpoints/{cid}/restore")).status_code == 200

    assert (await client.get(f"/api/lessons/{lid}/chats")).json() == []
    chats = [{"id": "m1", "text": "hi"}]
    assert (await client.put(f"/api/lessons/{lid}/chats", json=chats)).status_code == 200
    assert (await client.get(f"/api/lessons/{lid}/chats")).json() == chats

    resp = await client.delete(f"/api/lessons/{lid}")
    assert resp.status_code == 200
    assert _json(resp) == {"id": lid}
    assert (await client.post(f"/api/lessons/{lid}/restore")).status_code == 200

    resp = await client.get("/api/status")
    assert resp.status_code == 200
    assert {"llm", "model", "version"} <= set(_json(resp))


@pytest.mark.anyio
async def test_put_doc_too_large(settings: Settings) -> None:
    app2 = create_app(settings.model_copy(update={"max_markdown_bytes": 100}))
    async with app2.router.lifespan_context(app2):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app2),
            base_url="http://127.0.0.1:8765",
            headers={"X-DocuTeach-Token": "test-token"},
        ) as c:
            resp = await c.post("/api/lessons", json={"title": "big"})
            assert resp.status_code == 200
            lid = str(_json(resp)["id"])
            resp = await c.put(f"/api/lessons/{lid}/doc", json={"markdown": "x" * 200})
            assert resp.status_code == 413
            assert _json(resp)["code"] == "too_large"


@pytest.mark.anyio
async def test_error_shape(client: httpx.AsyncClient) -> None:
    resp = await client.get("/api/lessons/nope-123456/doc")
    assert resp.status_code == 404
    assert set(_json(resp)) == {"code", "message"}

    resp = await client.get("/api/lessons/BAD_ID/doc")
    assert resp.status_code == 400
    assert _json(resp)["code"] == "bad_id"

    resp = await client.put("/api/lessons/abc/doc", json={})
    assert resp.status_code == 422
    assert _json(resp)["code"] == "bad_request"


@pytest.mark.anyio
async def test_token_and_host(app: FastAPI) -> None:
    async with app.router.lifespan_context(app):
        async with await _unauth_client(app) as c:  # no token
            assert _json(await c.get("/api/lessons"))["code"] == "forbidden"
            assert (await c.get("/api/lessons")).status_code == 403

        async with await _unauth_client(app, **{"X-DocuTeach-Token": "wrong"}) as c:
            assert (await c.get("/api/lessons")).status_code == 403
            assert _json(await c.get("/api/lessons"))["code"] == "forbidden"

        headers = {"X-DocuTeach-Token": "test-token", "Host": "evil.example"}
        async with await _unauth_client(app, **headers) as c:
            assert (await c.get("/api/lessons")).status_code == 403


@pytest.mark.anyio
async def test_invalid_utf8_header(client: httpx.AsyncClient, app: FastAPI) -> None:
    resp = await client.post("/api/lessons", json={"title": "raw"})
    assert resp.status_code == 200
    lid = str(_json(resp)["id"])
    (app.state.library.lesson_dir(lid) / "lesson.md").write_bytes(b"\xff\xfebad")

    resp = await client.get(f"/api/lessons/{lid}/doc")
    assert resp.status_code == 200
    assert resp.headers.get("X-DocuTeach-Warning") == "decoded_with_replacement"


@pytest.mark.anyio
async def test_log_has_no_lesson_text(client: httpx.AsyncClient, settings: Settings) -> None:
    marker = "ZZMARKERTEXT"
    resp = await client.post("/api/lessons", json={"title": f"{marker}-title"})
    lid = str(_json(resp)["id"])
    await client.put(f"/api/lessons/{lid}/doc", json={"markdown": marker})
    await client.post(f"/api/lessons/{lid}/checkpoints", json={"name": marker, "markdown": marker})
    await client.put(f"/api/lessons/{lid}/chats", json=[{"id": "m", "text": marker}])

    for handler in logging.getLogger("docuteach").handlers:
        handler.flush()

    log_path = settings.log_dir / "backend.log"
    assert log_path.exists()
    text = log_path.read_text(encoding="utf-8")
    assert text
    assert marker not in text


def test_create_app_rejects(settings: Settings) -> None:
    with pytest.raises(ValueError):
        create_app(settings.model_copy(update={"token": ""}))
    with pytest.raises(ValueError):
        create_app(settings.model_copy(update={"llm_base_url": "http://example.com:8080"}))


@pytest.mark.anyio
async def test_log_records_lesson_id(client: httpx.AsyncClient, settings: Settings) -> None:
    resp = await client.post("/api/lessons", json={"title": "LogTest"})
    assert resp.status_code == 200
    lid = str(_json(resp)["id"])
    await client.get(f"/api/lessons/{lid}/doc")
    for handler in logging.getLogger("docuteach").handlers:
        handler.flush()
    log_text = (settings.log_dir / "backend.log").read_text(encoding="utf-8")
    assert any(f"lesson={lid}" in line for line in log_text.splitlines())
