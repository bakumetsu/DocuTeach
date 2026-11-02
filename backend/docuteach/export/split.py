"""PDF splitting and export planning."""

from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from typing import cast

from pypdf import PdfReader, PdfWriter

from docuteach.errors import ApiError
from docuteach.md.model import Meta
from docuteach.md.project import StudentDoc, StudentSplitPoint


@dataclass(frozen=True)
class PlanPart:
    part: int
    label: str
    targets: tuple[str, ...]
    blocks: tuple[int, int | None] | None = None
    pages: tuple[int, int] | None = None


def _to_int(x: object) -> int | None:
    if isinstance(x, bool):
        return None
    if isinstance(x, int):
        return x
    if isinstance(x, float) and x.is_integer():
        return int(x)
    return None


def parse_ranges(raw: object) -> list[tuple[int, int]]:
    if not isinstance(raw, list) or not raw:
        raise ApiError("bad_split", "Enter page ranges like 1-10, 11-20", 422)
    result: list[tuple[int, int]] = []
    prev_end: int = 0
    for item in cast("list[object]", raw):
        if not isinstance(item, (list, tuple)):
            raise ApiError("bad_split", "Enter page ranges like 1-10, 11-20", 422)
        item = cast("list[object] | tuple[object, ...]", item)
        if len(item) != 2:
            raise ApiError("bad_split", "Enter page ranges like 1-10, 11-20", 422)
        start = _to_int(item[0])
        end = _to_int(item[1])
        if start is None or end is None:
            raise ApiError("bad_split", "Enter page ranges like 1-10, 11-20", 422)
        if start < 1 or end < 1:
            raise ApiError("bad_split", "Enter page ranges like 1-10, 11-20", 422)
        if start > end:
            raise ApiError("bad_split", "Start must not be after end", 422)
        if start <= prev_end:
            raise ApiError("bad_split", "Ranges must go up and not overlap", 422)
        result.append((start, end))
        prev_end = end
    return result


def split_index(doc: StudentDoc) -> int | None:
    for i, block in enumerate(doc.blocks):
        if isinstance(block, StudentSplitPoint):
            return i
    return None


def plan_parts(meta: Meta, doc: StudentDoc) -> list[PlanPart]:
    data: dict[str, object] = meta.data if meta.data is not None else {}

    if data.get("lesson_type") == "exam":
        return [
            PlanPart(1, "Student paper", ("student_pdf",), blocks=(0, None)),
            PlanPart(2, "Teacher copy", ("teacher_docx",)),
        ]

    split_raw: object = data.get("split")
    split: dict[str, object] = (
        cast("dict[str, object]", split_raw) if isinstance(split_raw, dict) else {}
    )

    if split.get("by") == "pages":
        ranges = parse_ranges(split.get("ranges"))
        parts: list[PlanPart] = [
            PlanPart(i, f"Part {i}", ("student_pdf",), pages=(a, b))
            for i, (a, b) in enumerate(ranges, 1)
        ]
        parts.append(PlanPart(len(ranges) + 1, "Teacher guide", ("teacher_docx",)))
        return parts

    if split.get("by") == "marker":
        k = split_index(doc)
        if k is not None:
            return [
                PlanPart(1, "Lesson", ("student_pdf",), blocks=(0, k)),
                PlanPart(2, "Homework", ("student_pdf",), blocks=(k + 1, None)),
                PlanPart(3, "Teacher guide", ("teacher_docx",)),
            ]

    return [PlanPart(1, "Lesson", ("student_pdf", "teacher_docx"), blocks=(0, None))]


def cut_pdf(pdf: bytes, start: int, end: int) -> bytes:
    reader = PdfReader(BytesIO(pdf))
    total = len(reader.pages)
    if start > total:
        raise ApiError("bad_split", f"The document has only {total} pages", 422)
    end = min(end, total)
    writer = PdfWriter()
    for i in range(start - 1, end):
        writer.add_page(reader.pages[i])
    buf = BytesIO()
    writer.write(buf)
    return buf.getvalue()
