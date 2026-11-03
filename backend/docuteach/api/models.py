"""Model management endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from docuteach.config import Settings
from docuteach.llm.client import LlmClient
from docuteach.llm.models import current_model, list_models, select_model

router = APIRouter()


class SelectBody(BaseModel):
    id: str


@router.get("/models")
async def get_models(request: Request) -> JSONResponse:
    settings: Settings = request.app.state.settings  # type: ignore[no-any-return]
    client: LlmClient = request.app.state.llm_client  # type: ignore[no-any-return]
    return JSONResponse(content=await list_models(settings, client))


@router.get("/models/current")
async def get_current_model(request: Request) -> JSONResponse:
    settings: Settings = request.app.state.settings  # type: ignore[no-any-return]
    client: LlmClient = request.app.state.llm_client  # type: ignore[no-any-return]
    return JSONResponse(content=await current_model(settings, client))


@router.post("/models/select")
async def select(request: Request, body: SelectBody) -> JSONResponse:
    settings: Settings = request.app.state.settings  # type: ignore[no-any-return]
    client: LlmClient = request.app.state.llm_client  # type: ignore[no-any-return]
    return JSONResponse(content=await select_model(settings, client, body.id))
