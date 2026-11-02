"""Chats read/write endpoints."""

from __future__ import annotations

from typing import Any

import anyio
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from docuteach.api.deps import get_library
from docuteach.store.library import Library

router = APIRouter()


@router.get("/lessons/{lesson_id}/chats")
async def get_chats(
    lesson_id: str,
    library: Library = Depends(get_library),
) -> JSONResponse:
    chats: list[dict[str, Any]] = await anyio.to_thread.run_sync(library.read_chats, lesson_id)
    return JSONResponse(content=chats)


@router.put("/lessons/{lesson_id}/chats")
async def save_chats(
    lesson_id: str,
    body: list[dict[str, Any]],
    library: Library = Depends(get_library),
) -> JSONResponse:
    async with library.lock(lesson_id):
        await anyio.to_thread.run_sync(library.write_chats, lesson_id, body)
    return JSONResponse(content=body)
