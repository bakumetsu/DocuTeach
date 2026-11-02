"""Status endpoint."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from docuteach.api.deps import get_settings
from docuteach.config import Settings

router = APIRouter()


@router.get("/status")
async def status(settings: Settings = Depends(get_settings)) -> JSONResponse:
    return JSONResponse(content={"llm": "offline", "model": None, "version": settings.version})
