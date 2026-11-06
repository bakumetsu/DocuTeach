"""Model management endpoints."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, cast

import yaml
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from docuteach.config import Settings
from docuteach.errors import ApiError
from docuteach.llm.client import LlmClient
from docuteach.llm.models import (
    ModelState,
    current_model,
    list_models,
    manage_list,
    select_model,
    set_default,
    unload_model,
)
from docuteach.llm.overlay import ModelForm, entry_yaml, validate_form

router = APIRouter()


class SelectBody(BaseModel):
    id: str


class UnloadModelBody(BaseModel):
    id: str | None = None


class ModelFormBody(BaseModel):
    id: str
    model_path: str
    parallel: int = 4
    ctx_per_chat: int = 8192
    reasoning: bool = False
    temperature: float = 0.7
    top_p: float = 0.95
    top_k: int = 40
    min_p: float = 0.05
    ttl: int = 600


class ServerPathBody(BaseModel):
    path: str


def _state(request: Request) -> ModelState:
    return request.app.state.model_state  # type: ignore[no-any-return]


def _validated_form(state: ModelState, body: ModelFormBody) -> ModelForm:
    form = ModelForm(**body.model_dump())
    validate_form(form, taken_ids=set(state.managed_ids()))
    if not state.llama_server():
        raise ApiError("llama_server_missing", "Set the llama-server path first", 400)
    return form


@router.get("/models")
async def get_models(request: Request) -> JSONResponse:
    settings: Settings = request.app.state.settings  # type: ignore[no-any-return]
    client: LlmClient = request.app.state.llm_client  # type: ignore[no-any-return]
    state = _state(request)
    return JSONResponse(content=await list_models(settings, client, overlay=state.overlay))


@router.get("/models/current")
async def get_current_model(request: Request) -> JSONResponse:
    settings: Settings = request.app.state.settings  # type: ignore[no-any-return]
    client: LlmClient = request.app.state.llm_client  # type: ignore[no-any-return]
    state = _state(request)
    return JSONResponse(content=await current_model(settings, client, overlay=state.overlay))


@router.get("/models/{model_id}/context")
async def get_model_context(request: Request, model_id: str) -> JSONResponse:
    llm = request.app.state.llm  # type: ignore[no-any-return]
    return JSONResponse(content=await llm.context_info(model_id))


@router.post("/models/select")
async def select(request: Request, body: SelectBody) -> JSONResponse:
    settings: Settings = request.app.state.settings  # type: ignore[no-any-return]
    client: LlmClient = request.app.state.llm_client  # type: ignore[no-any-return]
    state = _state(request)
    result = await select_model(settings, client, body.id, overlay=state.overlay)
    return JSONResponse(content=result)


@router.get("/models/manage")
async def get_models_manage(request: Request) -> JSONResponse:
    settings: Settings = request.app.state.settings  # type: ignore[no-any-return]
    client: LlmClient = request.app.state.llm_client  # type: ignore[no-any-return]
    state = _state(request)
    return JSONResponse(content=await manage_list(settings, client, state))


@router.post("/models/default")
async def post_models_default(request: Request, body: SelectBody) -> JSONResponse:
    settings: Settings = request.app.state.settings  # type: ignore[no-any-return]
    state = _state(request)
    return JSONResponse(content=await set_default(settings, state, state.overlay, body.id))


@router.post("/models/unload")
async def post_models_unload(request: Request, body: UnloadModelBody) -> JSONResponse:
    settings: Settings = request.app.state.settings  # type: ignore[no-any-return]
    client: LlmClient = request.app.state.llm_client  # type: ignore[no-any-return]
    llm = request.app.state.llm  # type: ignore[no-any-return]
    state = _state(request)
    return JSONResponse(content=await unload_model(settings, client, llm, state.overlay, body.id))


@router.post("/models/custom/preview")
async def post_models_custom_preview(request: Request, body: ModelFormBody) -> JSONResponse:
    state = _state(request)
    form = _validated_form(state, body)
    return JSONResponse(content={"yaml": entry_yaml(state.llama_server(), form)})


@router.post("/models/custom")
async def post_models_custom(request: Request, body: ModelFormBody) -> JSONResponse:
    state = _state(request)
    form = _validated_form(state, body)
    text = entry_yaml(state.llama_server(), form)
    data: Any = yaml.safe_load(text)
    entry: dict[str, object] = cast("dict[str, Any]", data)["models"][form.id]  # type: ignore[index]
    stamp = state.overlay.put(form.id, entry)
    return JSONResponse(content={"id": form.id, "stamp": stamp})


@router.put("/models/custom/{model_id}")
async def put_models_custom(request: Request, model_id: str, body: ModelFormBody) -> JSONResponse:
    settings: Settings = request.app.state.settings  # type: ignore[no-any-return]
    state = _state(request)
    if model_id not in state.overlay.ids() or model_id in settings.model_allowlist:
        raise ApiError("not_found", "Model not found", 404)
    if body.id != model_id:
        raise ApiError("bad_model_form", "id in the body must match the id in the path", 400)
    form = ModelForm(**body.model_dump())
    validate_form(form, taken_ids=set(state.managed_ids()) - {model_id})
    if not state.llama_server():
        raise ApiError("llama_server_missing", "Set the llama-server path first", 400)
    data: Any = yaml.safe_load(entry_yaml(state.llama_server(), form))
    entry: dict[str, object] = cast("dict[str, Any]", data)["models"][form.id]  # type: ignore[index]
    stamp = state.overlay.put(form.id, entry, replace=True)
    return JSONResponse(content={"id": form.id, "stamp": stamp})


@router.delete("/models/custom/{model_id}")
async def delete_models_custom(request: Request, model_id: str) -> JSONResponse:
    settings: Settings = request.app.state.settings  # type: ignore[no-any-return]
    state = _state(request)
    if model_id not in state.overlay.ids() or model_id in settings.model_allowlist:
        raise ApiError("not_found", "Model not found", 404)
    state.overlay.remove(model_id)
    if state.read().get("default") == model_id:
        state.write(default=None)
    return JSONResponse(content={"id": model_id})


@router.post("/models/custom/undo")
async def post_models_custom_undo(request: Request) -> JSONResponse:
    state = _state(request)
    state.overlay.undo()
    return JSONResponse(content={"ok": True})


@router.post("/models/server-path")
async def post_models_server_path(request: Request, body: ServerPathBody) -> JSONResponse:
    state = _state(request)
    path = body.path
    if (
        not Path(path).is_file()
        or not path.lower().endswith("llama-server.exe")
        or '"' in path
        or "\n" in path
        or "\r" in path
    ):
        raise ApiError("bad_server_path", "path must be an existing llama-server.exe file", 400)
    path = os.path.normpath(os.path.abspath(path))
    state.write(llama_server_path=path)
    return JSONResponse(content={"path": path})
