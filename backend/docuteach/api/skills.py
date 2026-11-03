"""Skills listing endpoint."""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from docuteach.skills.registry import SKILLS

router = APIRouter()


@router.get("/skills")
async def get_skills() -> JSONResponse:
    items: list[dict[str, str]] = []
    for skill in SKILLS:
        item: dict[str, str] = {
            "command": skill.command,
            "name": skill.name,
            "description": skill.description,
            "status": skill.status,
        }
        if skill.insert_as is not None:
            item["insertAs"] = skill.insert_as
        items.append(item)
    return JSONResponse(content=items)
