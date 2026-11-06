"""Skills listing and management endpoints."""

from __future__ import annotations

import functools
import re
import threading
import urllib.parse
from collections.abc import Mapping

import anyio
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from docuteach.skills.manage import SkillManager

router = APIRouter()

_manager_lock = threading.Lock()


def get_manager(request: Request) -> SkillManager:
    state = request.app.state
    manager = getattr(state, "skill_manager", None)
    if manager is None:
        with _manager_lock:
            manager = getattr(state, "skill_manager", None)
            if manager is None:
                settings = state.settings
                manager = SkillManager(settings.data_dir / "skills", settings.trash_days)
                state.skill_manager = manager
    return manager


def _source_for(skill_command: str, source_by_command: Mapping[str, str]) -> str:
    raw = source_by_command.get(skill_command, "custom")
    return "builtin" if raw == "builtin" else "custom"


@router.get("/skills")
def get_skills(request: Request) -> JSONResponse:
    registry = request.app.state.llm.skills
    manager = get_manager(request)
    source_by_command: dict[str, str] = {}
    for entry in manager.list_all():
        cmd = entry.get("command")
        src = entry.get("source")
        if isinstance(cmd, str) and isinstance(src, str):
            source_by_command[cmd] = src
    items: list[dict[str, str]] = []
    for skill in registry.runnable():
        item: dict[str, str] = {
            "command": skill.command,
            "name": skill.name,
            "description": skill.description,
            "status": "active",
            "insertAs": skill.insert_as,
            "source": _source_for(skill.command, source_by_command),
        }
        items.append(item)
    return JSONResponse(content=items)


@router.get("/skills/manage")
async def manage_skills(request: Request) -> JSONResponse:
    manager = get_manager(request)
    items = await anyio.to_thread.run_sync(manager.list_all)
    return JSONResponse(content=items)


class SkillBody(BaseModel):
    command: str
    name: str
    description: str
    insertAs: str
    body: str
    tag: str | None = None
    replace: bool = False


@router.post("/skills")
async def create_skill(body: SkillBody, request: Request) -> JSONResponse:
    manager = get_manager(request)
    fields: dict[str, object] = body.model_dump()
    result = await anyio.to_thread.run_sync(functools.partial(manager.save, fields, body.replace))
    return JSONResponse(content=result)


class ImportPreviewBody(BaseModel):
    text: str


@router.post("/skills/import/preview")
async def import_preview_route(body: ImportPreviewBody, request: Request) -> JSONResponse:
    manager = get_manager(request)
    result = await anyio.to_thread.run_sync(functools.partial(manager.import_preview, body.text))
    return JSONResponse(content=result)


class ImportCommitBody(BaseModel):
    text: str
    onClash: str | None = None
    command: str | None = None


@router.post("/skills/import/commit")
async def import_commit_route(body: ImportCommitBody, request: Request) -> JSONResponse:
    manager = get_manager(request)
    result = await anyio.to_thread.run_sync(
        functools.partial(manager.import_commit, body.text, body.onClash, body.command)
    )
    return JSONResponse(content=result)


@router.post("/skills/restore-defaults")
async def restore_defaults_route(request: Request) -> JSONResponse:
    manager = get_manager(request)
    await anyio.to_thread.run_sync(manager.restore_defaults)
    return JSONResponse(content={"ok": True})


@router.post("/skills/trash/{trash_id}/restore")
async def restore_trash_route(trash_id: str, request: Request) -> JSONResponse:
    manager = get_manager(request)
    result = await anyio.to_thread.run_sync(functools.partial(manager.restore_trash, trash_id))
    return JSONResponse(content=result)


@router.get("/skills/{slug}/file")
async def export_skill_file(slug: str, request: Request) -> Response:
    manager = get_manager(request)
    name, data = await anyio.to_thread.run_sync(functools.partial(manager.export_file, slug))
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", name)
    disposition = f"attachment; filename=\"{safe}\"; filename*=UTF-8''{urllib.parse.quote(name)}"
    return Response(
        content=data,
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": disposition},
    )


@router.post("/skills/{slug}/reset")
async def reset_skill_route(slug: str, request: Request) -> JSONResponse:
    manager = get_manager(request)
    result = await anyio.to_thread.run_sync(functools.partial(manager.reset, slug))
    return JSONResponse(content={"ok": True, "command": result})


@router.delete("/skills/{slug}")
async def delete_skill_route(slug: str, request: Request) -> JSONResponse:
    manager = get_manager(request)
    result = await anyio.to_thread.run_sync(functools.partial(manager.delete, slug))
    return JSONResponse(content={"trashId": result})
