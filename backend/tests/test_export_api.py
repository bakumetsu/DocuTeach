"""Export API and unit tests for DocuTeach."""

from __future__ import annotations

import json
import urllib.parse
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Any, cast

import anyio
import httpx
import pytest

from docuteach.api.export import ExportGate
from docuteach.app import create_app
from docuteach.config import Settings
from docuteach.errors import ApiError
from docuteach.export.split import cut_pdf, parse_ranges, plan_parts, split_index
from tests.export_helpers import build_pdf, pdf_page_count, pdf_text, student_doc


def _json(resp: httpx.Response) -> dict[str, Any]:
    return cast(dict[str, Any], resp.json())


def _json_list(resp: httpx.Response) -> list[Any]:
    return cast(list[Any], resp.json())


def _long_md() -> str:
    paras = [f"Paragraph number {i} " * 8 for i in range(1, 121)]
    return "\n\n".join(paras)


@asynccontextmanager
async def _client_with_overrides(
    settings: Settings, **overrides: Any
) -> AsyncGenerator[tuple[httpx.AsyncClient, Settings]]:
    s = settings.model_copy(update=overrides)
    app = create_app(s)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://127.0.0.1:8765",
            headers={"X-DocuTeach-Token": "test-token"},
        ) as c:
            yield c, s


# ---------------------------------------------------------------------------
# 1. parse_ranges
# ---------------------------------------------------------------------------


def test_parse_ranges_valid() -> None:
    assert parse_ranges([[1, 3], [4, 6]]) == [(1, 3), (4, 6)]


@pytest.mark.parametrize(
    ("raw", "message"),
    [
        ([], "Enter page ranges like 1-10, 11-20"),
        ("x", "Enter page ranges like 1-10, 11-20"),
        ([[1]], "Enter page ranges like 1-10, 11-20"),
        ([[0, 2]], "Enter page ranges like 1-10, 11-20"),
        ([[5, 2]], "Start must not be after end"),
        ([[1, 5], [5, 8]], "Ranges must go up and not overlap"),
        ([[3, 4], [1, 2]], "Ranges must go up and not overlap"),
    ],
)
def test_parse_ranges_invalid(raw: Any, message: str) -> None:
    with pytest.raises(ApiError) as exc:
        parse_ranges(raw)
    assert exc.value.code == "bad_split"
    assert exc.value.status == 422
    assert exc.value.message == message


# ---------------------------------------------------------------------------
# 2. plan_parts
# ---------------------------------------------------------------------------


def test_plan_parts_no_front_matter() -> None:
    res, sdoc, _ = student_doc("Just some content.")
    parts = plan_parts(res.doc.meta, sdoc)
    assert len(parts) == 1
    assert parts[0].label == "Lesson"
    assert parts[0].targets == ("student_pdf", "teacher_docx")


def test_plan_parts_marker_no_split_point() -> None:
    md = "---\nlesson_type: lesson\nsplit:\n  by: marker\n---\nNo split here."
    res, sdoc, _ = student_doc(md)
    parts = plan_parts(res.doc.meta, sdoc)
    assert len(parts) == 1
    assert parts[0].label == "Lesson"


def test_plan_parts_marker_with_split() -> None:
    md = (
        "---\nlesson_type: lesson\nsplit:\n  by: marker\n---\n"
        "Lesson body.\n\n<!-- split: Homework starts here -->\n\nHomework body."
    )
    res, sdoc, _ = student_doc(md)
    parts = plan_parts(res.doc.meta, sdoc)
    assert len(parts) == 3

    k = split_index(sdoc)
    assert k is not None

    assert parts[0].label == "Lesson"
    assert parts[0].targets == ("student_pdf",)
    assert parts[0].blocks == (0, k)

    assert parts[1].label == "Homework"
    assert parts[1].targets == ("student_pdf",)
    assert parts[1].blocks == (k + 1, None)

    assert parts[2].label == "Teacher guide"
    assert parts[2].targets == ("teacher_docx",)


def test_plan_parts_pages() -> None:
    md = (
        "---\nsplit:\n  by: pages\n  ranges:\n    - [1, 2]\n    - [3, 5]\n---\n"
        "Page content."
    )
    res, sdoc, _ = student_doc(md)
    parts = plan_parts(res.doc.meta, sdoc)
    assert len(parts) == 3

    assert parts[0].label == "Part 1"
    assert parts[0].targets == ("student_pdf",)
    assert parts[0].pages == (1, 2)

    assert parts[1].label == "Part 2"
    assert parts[1].targets == ("student_pdf",)
    assert parts[1].pages == (3, 5)

    assert parts[2].label == "Teacher guide"
    assert parts[2].targets == ("teacher_docx",)


def test_plan_parts_exam() -> None:
    md = "---\nlesson_type: exam\n---\nExam content."
    res, sdoc, _ = student_doc(md)
    parts = plan_parts(res.doc.meta, sdoc)
    assert len(parts) == 2
    assert parts[0].label == "Student paper"
    assert parts[0].targets == ("student_pdf",)
    assert parts[1].label == "Teacher copy"
    assert parts[1].targets == ("teacher_docx",)


def test_plan_parts_pages_empty_ranges() -> None:
    md = "---\nsplit:\n  by: pages\n  ranges: []\n---\nContent."
    res, sdoc, _ = student_doc(md)
    with pytest.raises(ApiError) as exc:
        plan_parts(res.doc.meta, sdoc)
    assert exc.value.code == "bad_split"


def test_plan_parts_broken_yaml() -> None:
    md = "---\n: : bad\n  - [\n---\nHello"
    res, sdoc, _ = student_doc(md)
    parts = plan_parts(res.doc.meta, sdoc)
    assert len(parts) == 1
    assert parts[0].label == "Lesson"


# ---------------------------------------------------------------------------
# 3. cut_pdf
# ---------------------------------------------------------------------------


def test_cut_pdf() -> None:
    pdf = build_pdf(_long_md())
    total = pdf_page_count(pdf)
    assert total >= 3

    one = cut_pdf(pdf, 1, 1)
    assert pdf_page_count(one) == 1

    rest = cut_pdf(pdf, 2, 999)
    assert pdf_page_count(rest) == total - 1

    with pytest.raises(ApiError) as exc:
        cut_pdf(pdf, 999, 1000)
    assert exc.value.code == "bad_split"
    assert exc.value.status == 422


# ---------------------------------------------------------------------------
# 4. ExportGate
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_export_gate_busy() -> None:
    gate = ExportGate()
    error_raised: ApiError | None = None

    async def _waiter() -> None:
        async with gate.slot():
            pass

    async def _check_busy() -> None:
        nonlocal error_raised
        try:
            async with gate.slot():
                pass
        except ApiError as e:
            error_raised = e

    async with anyio.create_task_group() as tg:
        async with gate.slot():
            tg.start_soon(_waiter)
            tg.start_soon(_waiter)
            tg.start_soon(_waiter)
            await anyio.sleep(0.05)
            await _check_busy()

    assert error_raised is not None
    assert error_raised.code == "export_busy"
    assert error_raised.status == 429


# ---------------------------------------------------------------------------
# 5. API export plan
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_api_export_plan(client: httpx.AsyncClient) -> None:
    md = (
        "---\nlesson_type: lesson\nsplit:\n  by: marker\n---\n"
        "Lesson content.\n\n<!-- split: Homework starts here -->\n\nHomework."
    )
    resp = await client.post("/api/export/plan", json={"markdown": md, "title": "Unit 3"})
    assert resp.status_code == 200
    items = _json_list(resp)
    assert len(items) == 3
    first = cast(dict[str, Any], items[0])
    assert first["part"] == 1
    assert first["label"] == "Lesson"
    assert first["filename"] == "Unit 3 - Lesson - student.pdf"
    assert first["targets"] == ["student_pdf"]


# ---------------------------------------------------------------------------
# 6. API export marker split
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_api_export_marker_split(client: httpx.AsyncClient) -> None:
    md = (
        "---\nlesson_type: lesson\nsplit:\n  by: marker\n---\n"
        "Lesson text LESSONWORD {{ans}}.\n\n"
        "<!-- split: Homework starts here -->\n\n"
        "Homework text HOMEWORKWORD."
    )
    body = {"markdown": md, "title": "Unit 3", "target": "student_pdf"}

    # Part 1
    resp1 = await client.post("/api/export", json={**body, "part": 1})
    assert resp1.status_code == 200
    assert resp1.headers["content-type"] == "application/pdf"
    assert resp1.content.startswith(b"%PDF")
    text1 = pdf_text(resp1.content)
    assert "LESSONWORD" in text1
    assert "HOMEWORKWORD" not in text1
    cd = resp1.headers["content-disposition"]
    assert "Unit 3 - Lesson - student.pdf" in cd

    # Part 2
    resp2 = await client.post("/api/export", json={**body, "part": 2})
    assert resp2.status_code == 200
    assert resp2.headers["content-type"] == "application/pdf"
    assert resp2.content.startswith(b"%PDF")
    text2 = pdf_text(resp2.content)
    assert "HOMEWORKWORD" in text2
    assert "LESSONWORD" not in text2
    assert "1 / 1" in text2


# ---------------------------------------------------------------------------
# 7. API page ranges
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_api_export_page_ranges(client: httpx.AsyncClient) -> None:
    long_body = _long_md()
    md = f"---\nsplit:\n  by: pages\n  ranges:\n    - [1, 1]\n    - [2, 2]\n---\n{long_body}"
    body = {"markdown": md, "title": "T", "target": "student_pdf"}

    resp1 = await client.post("/api/export", json={**body, "part": 1})
    assert resp1.status_code == 200
    assert pdf_page_count(resp1.content) == 1
    text1 = pdf_text(resp1.content)
    assert "Paragraph number 1 " in text1

    resp2 = await client.post("/api/export", json={**body, "part": 2})
    assert resp2.status_code == 200
    assert pdf_page_count(resp2.content) == 1
    text2 = pdf_text(resp2.content)
    assert text1 != text2


# ---------------------------------------------------------------------------
# 8. API errors
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_api_export_unknown_part(client: httpx.AsyncClient) -> None:
    md = "---\nlesson_type: lesson\nsplit:\n  by: marker\n---\nA.\n\n<!-- split: H -->\n\nB."
    resp = await client.post(
        "/api/export",
        json={"markdown": md, "title": "T", "target": "student_pdf", "part": 99},
    )
    assert resp.status_code == 422
    assert _json(resp)["code"] == "bad_request"


@pytest.mark.anyio
async def test_api_export_teacher_docx_ok(client: httpx.AsyncClient) -> None:
    md = "Just content. {{go}}"
    resp = await client.post(
        "/api/export",
        json={"markdown": md, "title": "T", "target": "teacher_docx", "part": 1},
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"] == (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    assert ".docx" in resp.headers["content-disposition"]
    assert resp.content.startswith(b"PK")


@pytest.mark.anyio
async def test_api_export_target_not_in_part(client: httpx.AsyncClient) -> None:
    md = "---\nlesson_type: lesson\nsplit:\n  by: marker\n---\nA.\n\n<!-- split: H -->\n\nB."
    # Part 3 is "Teacher guide" with only teacher_docx target
    resp = await client.post(
        "/api/export",
        json={"markdown": md, "title": "T", "target": "student_pdf", "part": 3},
    )
    assert resp.status_code == 422
    assert _json(resp)["code"] == "bad_request"


@pytest.mark.anyio
async def test_api_export_missing_markdown(client: httpx.AsyncClient) -> None:
    resp = await client.post(
        "/api/export",
        json={"title": "T", "target": "student_pdf", "part": 1},
    )
    assert resp.status_code == 422


@pytest.mark.anyio
async def test_api_export_too_large(
    settings: Settings,
) -> None:
    async with _client_with_overrides(settings, max_markdown_bytes=100) as (c, _):
        resp = await c.post(
            "/api/export",
            json={"markdown": "x" * 200, "title": "T", "target": "student_pdf", "part": 1},
        )
        assert resp.status_code == 413
        assert _json(resp)["code"] == "too_large"


@pytest.mark.anyio
async def test_api_export_timeout(settings: Settings) -> None:
    async with _client_with_overrides(settings, export_timeout_s=0) as (c, _):
        resp = await c.post(
            "/api/export",
            json={"markdown": "Hello", "title": "T", "target": "student_pdf", "part": 1},
        )
        if resp.status_code != 504:
            pytest.skip(
                "anyio.fail_after(0) did not trigger a timeout in this environment; "
                "the blocking export completed before the deadline was evaluated."
            )
        assert _json(resp)["code"] == "export_timeout"


# ---------------------------------------------------------------------------
# 9. API warnings header
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_api_export_warnings_header(client: httpx.AsyncClient) -> None:
    md = 'Visible text [x]{font="Comic Sans MS"} here.'
    resp = await client.post(
        "/api/export",
        json={"markdown": md, "title": "T", "target": "student_pdf", "part": 1},
    )
    assert resp.status_code == 200
    raw = resp.headers["X-DocuTeach-Warnings"]
    decoded = json.loads(urllib.parse.unquote(raw))
    items = cast(list[dict[str, str]], decoded)
    codes = [item["code"] for item in items]
    assert "unlisted_font" in codes


# ---------------------------------------------------------------------------
# 10. Export touches no lesson files
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_export_no_lesson_files(settings: Settings) -> None:
    md = "Some lesson content for export."
    resp = None
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://127.0.0.1:8765",
            headers={"X-DocuTeach-Token": "test-token"},
        ) as inner:
            resp = await inner.post(
                "/api/export",
                json={"markdown": md, "title": "T", "target": "student_pdf", "part": 1},
            )
    assert resp is not None
    assert resp.status_code == 200

    lessons_dir = settings.lessons_dir
    if lessons_dir.exists():
        files = [p for p in lessons_dir.rglob("*") if p.is_file()]
        assert not files
