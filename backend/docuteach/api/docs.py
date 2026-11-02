"""Document read/write endpoints."""

from __future__ import annotations

import anyio
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from docuteach.api.deps import get_library
from docuteach.store.library import Library
from docuteach.store.models import DocRecord

router = APIRouter()


class SaveDocBody(BaseModel):
    markdown: str


@router.get("/lessons/{lesson_id}/doc")
async def get_doc(
    lesson_id: str,
    library: Library = Depends(get_library),
) -> JSONResponse:
    record: DocRecord
    used_replacement: bool
    record, used_replacement = await anyio.to_thread.run_sync(library.read_doc, lesson_id)
    response = JSONResponse(content=record.model_dump(by_alias=True))
    if used_replacement:
        response.headers["X-DocuTeach-Warning"] = "decoded_with_replacement"
    return response


@router.put("/lessons/{lesson_id}/doc")
async def save_doc(
    lesson_id: str,
    body: SaveDocBody,
    library: Library = Depends(get_library),
) -> JSONResponse:
    async with library.lock(lesson_id):
        record: DocRecord = await anyio.to_thread.run_sync(
            library.write_doc, lesson_id, body.markdown
        )
    return JSONResponse(content=record.model_dump(by_alias=True))
