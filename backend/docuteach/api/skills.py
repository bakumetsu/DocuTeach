"""Skills listing endpoint."""

from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter()


@router.get("/skills")
def get_skills(request: Request) -> JSONResponse:
    registry = request.app.state.llm.skills
    items: list[dict[str, str]] = []
    for skill in registry.runnable():
        item: dict[str, str] = {
            "command": skill.command,
            "name": skill.name,
            "description": skill.description,
            "status": "active",
            "insertAs": skill.insert_as,
        }
        items.append(item)
    return JSONResponse(content=items)
