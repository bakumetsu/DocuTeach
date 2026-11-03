"""Status endpoint."""

from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from docuteach.config import Settings
from docuteach.llm.client import LlmClient

router = APIRouter()


@router.get("/status")
async def status(request: Request) -> JSONResponse:
    settings: Settings = request.app.state.settings  # type: ignore[no-any-return]
    client: LlmClient = request.app.state.llm_client  # type: ignore[no-any-return]
    try:
        online = await client.ping()
    except Exception:
        online = False
    model: str | None = None
    if online:
        try:
            model = await client.running()
        except Exception:
            pass
    data: dict[str, object] = {
        "llm": "online" if online else "offline",
        "model": model,
        "version": settings.version,
    }
    return JSONResponse(content=data)
