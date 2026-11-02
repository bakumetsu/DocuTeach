"""Checkpoint endpoints."""

from __future__ import annotations

import anyio
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from docuteach.api.deps import get_library, get_settings
from docuteach.config import Settings
from docuteach.store import checkpoints as cp
from docuteach.store.library import Library
from docuteach.store.models import Checkpoint

router = APIRouter()


class CreateCheckpointBody(BaseModel):
    name: str
    markdown: str
    auto: bool = False


@router.get("/lessons/{lesson_id}/checkpoints")
async def list_checkpoints(
    lesson_id: str,
    library: Library = Depends(get_library),
) -> JSONResponse:
    lesson_dir = await anyio.to_thread.run_sync(library.require_dir, lesson_id)
    checkpoints: list[Checkpoint] = await anyio.to_thread.run_sync(cp.list_checkpoints, lesson_dir)
    return JSONResponse(content=[c.model_dump(by_alias=True) for c in checkpoints])


@router.post("/lessons/{lesson_id}/checkpoints", status_code=201)
async def create_checkpoint(
    lesson_id: str,
    body: CreateCheckpointBody,
    library: Library = Depends(get_library),
    settings: Settings = Depends(get_settings),
) -> JSONResponse:
    lesson_dir = await anyio.to_thread.run_sync(library.require_dir, lesson_id)
    async with library.lock(lesson_id):
        checkpoint: Checkpoint = await anyio.to_thread.run_sync(
            cp.create_checkpoint,
            lesson_dir,
            settings,
            body.name,
            body.markdown,
            body.auto,
        )
    return JSONResponse(content=checkpoint.model_dump(by_alias=True))


@router.delete("/lessons/{lesson_id}/checkpoints/{checkpoint_id}")
async def remove_checkpoint(
    lesson_id: str,
    checkpoint_id: str,
    library: Library = Depends(get_library),
) -> JSONResponse:
    lesson_dir = await anyio.to_thread.run_sync(library.require_dir, lesson_id)
    async with library.lock(lesson_id):
        await anyio.to_thread.run_sync(cp.remove_checkpoint, lesson_dir, checkpoint_id)
    return JSONResponse(content={})


@router.post("/lessons/{lesson_id}/checkpoints/{checkpoint_id}/restore")
async def restore_checkpoint(
    lesson_id: str,
    checkpoint_id: str,
    library: Library = Depends(get_library),
) -> JSONResponse:
    lesson_dir = await anyio.to_thread.run_sync(library.require_dir, lesson_id)
    async with library.lock(lesson_id):
        checkpoint: Checkpoint = await anyio.to_thread.run_sync(
            cp.restore_checkpoint, lesson_dir, checkpoint_id
        )
    return JSONResponse(content=checkpoint.model_dump(by_alias=True))
