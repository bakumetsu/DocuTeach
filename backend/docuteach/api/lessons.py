"""Lesson CRUD endpoints."""

from __future__ import annotations

import anyio
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from docuteach.api.deps import get_library
from docuteach.store.library import Library
from docuteach.store.models import LessonMeta

router = APIRouter()


class CreateLessonBody(BaseModel):
    title: str | None = None


class RenameLessonBody(BaseModel):
    title: str


@router.get("/lessons")
async def list_lessons(library: Library = Depends(get_library)) -> JSONResponse:
    lessons: list[LessonMeta] = await anyio.to_thread.run_sync(library.list_lessons)
    return JSONResponse(content=[m.model_dump(by_alias=True) for m in lessons])


@router.post("/lessons", status_code=201)
async def create_lesson(
    body: CreateLessonBody,
    library: Library = Depends(get_library),
) -> JSONResponse:
    meta: LessonMeta = await anyio.to_thread.run_sync(library.create_lesson, body.title)
    return JSONResponse(content=meta.model_dump(by_alias=True))


@router.patch("/lessons/{lesson_id}")
async def rename_lesson(
    lesson_id: str,
    body: RenameLessonBody,
    library: Library = Depends(get_library),
) -> JSONResponse:
    async with library.lock(lesson_id):
        meta: LessonMeta = await anyio.to_thread.run_sync(
            library.rename_lesson, lesson_id, body.title
        )
    return JSONResponse(content=meta.model_dump(by_alias=True))


@router.delete("/lessons/{lesson_id}")
async def delete_lesson(
    lesson_id: str,
    library: Library = Depends(get_library),
) -> JSONResponse:
    async with library.lock(lesson_id):
        deleted_id: str = await anyio.to_thread.run_sync(library.delete_lesson, lesson_id)
    return JSONResponse(content={"id": deleted_id})


@router.post("/lessons/{lesson_id}/restore")
async def restore_lesson(
    lesson_id: str,
    library: Library = Depends(get_library),
) -> JSONResponse:
    async with library.lock(lesson_id):
        meta: LessonMeta = await anyio.to_thread.run_sync(library.restore_lesson, lesson_id)
    return JSONResponse(content=meta.model_dump(by_alias=True))
