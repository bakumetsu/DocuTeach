"""Chat streaming endpoint."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse

from docuteach.llm.stream import ChatRequest, LlmService

router = APIRouter()


@router.post("/chat/stream")
async def chat_stream(request: Request, body: ChatRequest) -> StreamingResponse:
    llm: LlmService = request.app.state.llm  # type: ignore[no-any-return]
    messages = await llm.prepare(body)

    async def gen() -> AsyncIterator[str]:
        async for event in llm.events(body, messages):
            yield json.dumps(event, separators=(",", ":")) + "\n"

    return StreamingResponse(gen(), media_type="application/x-ndjson")


@router.post("/chats/{chat_id}/release")
async def release_chat(request: Request, chat_id: str) -> JSONResponse:
    llm: LlmService = request.app.state.llm  # type: ignore[no-any-return]
    await llm.release(chat_id)
    return JSONResponse({"ok": True})
