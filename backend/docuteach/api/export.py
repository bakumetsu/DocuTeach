"""Export API endpoints for PDF generation."""

from __future__ import annotations

import json
import re
import urllib.parse
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Annotated

import anyio
from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from pydantic import BaseModel

from docuteach.api.deps import get_settings
from docuteach.config import Settings
from docuteach.errors import ApiError
from docuteach.export.names import content_disposition, sanitize_filename
from docuteach.export.split import PlanPart, cut_pdf, plan_parts
from docuteach.export.typst_inline import PageStyle, read_page_style
from docuteach.export.typst_render import compile_pdf, render_source
from docuteach.md.parser import ParseResult, parse_markdown
from docuteach.md.project import StudentDoc, project_student

router = APIRouter()

# ---------------------------------------------------------------------------
# Concurrency gate
# ---------------------------------------------------------------------------


class ExportGate:
    def __init__(self) -> None:
        self._sem: anyio.Semaphore = anyio.Semaphore(1)
        self._waiting: int = 0

    @asynccontextmanager
    async def slot(self) -> AsyncGenerator[None]:
        if self._waiting >= 3:
            raise ApiError(
                "export_busy",
                "Too many exports are waiting. Try again in a moment.",
                429,
            )
        self._waiting += 1
        try:
            await self._sem.acquire()
        finally:
            self._waiting -= 1
        try:
            yield
        finally:
            self._sem.release()


def get_gate(request: Request) -> ExportGate:
    return request.app.state.export_gate  # type: ignore[no-any-return]


# ---------------------------------------------------------------------------
# Internal types
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Prepared:
    res: ParseResult
    sdoc: StudentDoc
    page: PageStyle
    parts: list[PlanPart]


# ---------------------------------------------------------------------------
# Body models
# ---------------------------------------------------------------------------


class PlanBody(BaseModel):
    markdown: str
    title: str = ""


class ExportBody(BaseModel):
    markdown: str
    title: str = ""
    target: str
    part: int = 1


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_CODE_RE = re.compile(r"^([a-z_]+): (.*)$")


def _prepare(markdown: str, settings: Settings) -> Prepared:
    if len(markdown.encode("utf-8")) > settings.max_markdown_bytes:
        raise ApiError("too_large", "The document is too large to export", 413)
    res = parse_markdown(markdown)
    sdoc = project_student(res.doc)
    page = read_page_style(res.doc.meta)
    parts = plan_parts(res.doc.meta, sdoc)
    return Prepared(res=res, sdoc=sdoc, page=page, parts=parts)


def _warning_items(texts: list[str]) -> list[dict[str, str]]:
    items: list[dict[str, str]] = []
    for text in texts:
        m = _CODE_RE.match(text)
        if m is not None:
            items.append({"code": m.group(1), "message": m.group(2)})
        else:
            items.append({"code": "parse_warning", "message": text})
    return items


def _do_export_blocking(
    body: ExportBody, settings: Settings
) -> tuple[bytes, str, list[dict[str, str]]]:
    prepared = _prepare(body.markdown, settings)

    part = next((p for p in prepared.parts if p.part == body.part), None)
    if part is None:
        raise ApiError("bad_request", "Unknown part", 422)
    if body.target not in part.targets:
        raise ApiError("bad_request", "That part has no such file", 422)
    if body.target == "teacher_docx":
        raise ApiError(
            "not_available", "Teacher DOCX export is not available yet", 501
        )
    if body.target != "student_pdf":
        raise ApiError("bad_request", "That part has no such file", 422)

    if part.pages is not None:
        rr = render_source(prepared.sdoc, prepared.page)
        pdf = compile_pdf(rr.source)
        pdf = cut_pdf(pdf, part.pages[0], part.pages[1])
    else:
        assert part.blocks is not None
        lo, hi = part.blocks
        rr = render_source(prepared.sdoc, prepared.page, lo, hi)
        pdf = compile_pdf(rr.source)

    # Drop parser warnings for unlisted fonts — the renderer recomputes from what students see.
    all_warnings: list[str] = [
        w for w in prepared.res.warnings if not w.startswith("unlisted_font:")
    ]
    for w in rr.warnings:
        if w not in all_warnings:
            all_warnings.append(w)

    filename = sanitize_filename(body.title, part.label, "student")
    return pdf, filename, _warning_items(all_warnings)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/export/plan")
async def export_plan(
    body: PlanBody,
    settings: Annotated[Settings, Depends(get_settings)],
) -> list[dict[str, object]]:
    prepared = await anyio.to_thread.run_sync(_prepare, body.markdown, settings)
    items: list[dict[str, object]] = []
    for p in prepared.parts:
        if "student_pdf" in p.targets:
            name = sanitize_filename(body.title, p.label, "student")
        else:
            name = sanitize_filename(body.title, p.label, "teacher")
        items.append(
            {
                "part": p.part,
                "label": p.label,
                "filename": name,
                "targets": list(p.targets),
            }
        )
    return items


@router.post("/export")
async def do_export(
    body: ExportBody,
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
) -> Response:
    gate = get_gate(request)
    async with gate.slot():
        try:
            with anyio.fail_after(settings.export_timeout_s):
                pdf, filename, warning_items = await anyio.to_thread.run_sync(
                    _do_export_blocking, body, settings
                )
        except TimeoutError:
            raise ApiError("export_timeout", "The export took too long", 504) from None

    headers: dict[str, str] = {
        "Content-Disposition": content_disposition(filename),
        "X-DocuTeach-Warnings": urllib.parse.quote(
            json.dumps(warning_items, ensure_ascii=False), safe=""
        ),
    }
    return Response(content=pdf, media_type="application/pdf", headers=headers)
