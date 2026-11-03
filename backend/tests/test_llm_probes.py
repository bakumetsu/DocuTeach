from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any, cast

import anyio
import pytest

from docuteach.config import Settings
from docuteach.llm.client import LlmClient
from docuteach.llm.stream import ChatMessage, ChatRequest, LlmService

pytestmark = [pytest.mark.llm, pytest.mark.anyio]

MODEL = "byteshape"


@pytest.fixture()
async def client(tmp_path: Path) -> AsyncIterator[LlmClient]:
    settings = Settings(data_dir=tmp_path, log_dir=tmp_path, token="t", swap_timeout_s=600)
    c = LlmClient(settings)
    yield c
    await c.aclose()


async def _skip_if_offline(client: LlmClient) -> None:
    if not await client.ping():
        pytest.skip("llama-swap is not reachable")


async def test_probe_models_and_running(client: LlmClient) -> None:
    await _skip_if_offline(client)
    models = await client.list_models()
    print(f"models: {models}")
    assert MODEL in models
    running = await client.running()
    print(f"running: {running!r}")
    assert running is None or isinstance(running, str)


async def test_probe_load(client: LlmClient) -> None:
    await _skip_if_offline(client)
    await client.load(MODEL)
    running = await client.running()
    print(f"running after load: {running!r}")
    assert running == MODEL


async def test_probe_props(client: LlmClient) -> None:
    await _skip_if_offline(client)
    await client.load(MODEL)
    props = await client.props(MODEL)
    assert props is not None, "props returned None"
    total_slots, n_ctx = props
    print(f"total_slots={total_slots} n_ctx={n_ctx}")
    assert total_slots >= 1


async def test_probe_erase_slot(client: LlmClient) -> None:
    await _skip_if_offline(client)
    await client.erase_slot(MODEL, 0)
    print("erase_slot completed without raising")
    resp = await client.http.post(f"/upstream/{MODEL}/slots/0", params={"action": "erase"})
    print(f"raw erase: status={resp.status_code} body={resp.text[:100]}")


async def test_probe_abort_stops_decoding(client: LlmClient) -> None:
    await _skip_if_offline(client)
    await client.load(MODEL)
    messages: list[dict[str, str]] = [
        {"role": "user", "content": "Count from 1 to 500 slowly, one number per line."}
    ]
    async with client.stream_chat(MODEL, messages, 0) as resp:
        lines = resp.aiter_lines()
        for _ in range(5):
            try:
                line = await anext(lines)
            except StopAsyncIteration:
                break
            print(f"stream line: {line[:80]}")
    # Connection is now closed; poll slots until idle or timeout.
    still_processing = True
    slot_list: list[dict[str, Any]] = []
    for _ in range(20):
        resp = await client.http.get(f"/upstream/{MODEL}/slots")
        if resp.status_code == 404:
            pytest.skip("slots endpoint not available")
        data: Any = resp.json()
        keys: object = (
            list(cast("dict[str, Any]", data)) if isinstance(data, dict) else type(data).__name__
        )
        print(f"slots response keys: {keys}")
        slot_list = []
        if isinstance(data, list):
            slot_list = cast("list[dict[str, Any]]", data)
        elif isinstance(data, dict):
            raw: Any = cast("dict[str, Any]", data).get("slots", data)
            if isinstance(raw, list):
                slot_list = cast("list[dict[str, Any]]", raw)
        still_processing = any(s.get("is_processing") for s in slot_list)
        if not still_processing:
            break
        await anyio.sleep(0.5)
    assert not still_processing, f"slot still processing: {slot_list}"


async def test_probe_ccq_end_to_end(client: LlmClient, tmp_path: Path) -> None:
    await _skip_if_offline(client)
    settings = Settings(data_dir=tmp_path, log_dir=tmp_path, token="t", swap_timeout_s=600)
    service = LlmService(settings, client)
    req = ChatRequest(
        chatId="probe",
        model=MODEL,
        skill="/ccq",
        messages=[ChatMessage(role="user", content="Present perfect vs past simple, B1 students.")],
    )
    messages = await service.prepare(req)
    events: list[dict[str, object]] = []
    async for ev in service.events(req, messages):
        events.append(ev)
    assert events, "no events produced"
    last = events[-1]
    print(f"last event: {last}")
    assert last["type"] == "done"
    structured: dict[str, object] | None = None
    for ev in events:
        if ev["type"] == "structured":
            structured = ev
            break
    print(f"structured event present: {structured is not None}")
    fallback: object | None = last.get("fallback")
    print(f"fallback value: {fallback!r}")
    has_structured_teacher = structured is not None and structured.get("kind") == "teacherNote"
    has_fallback_text = fallback == "text"
    assert has_structured_teacher or has_fallback_text, (
        "expected structured teacherNote or text fallback"
    )
