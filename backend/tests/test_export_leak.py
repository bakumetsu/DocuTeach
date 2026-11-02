"""Tests that teacher-only content never leaks into student exports."""

from __future__ import annotations

import re
from pathlib import Path
from typing import cast

import httpx
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from tests.export_helpers import build_pdf, build_source, pdf_everything, pdf_text, squash

FIXTURE: Path = Path(__file__).parent / "fixtures" / "leak.md"

MARKERS: list[str] = [
    "ZZ-NOTE-1",
    "ZZ-ANS-2",
    "ZZ-ALT-3",
    "ZZ-DIST-4",
    "ZZ-RAW-5",
    "ZZ-META-6",
    "ZZ-SPLIT-7",
    "ZZ-CMT-8",
    "ZZ-FONT-9",
]


def _read_fixture() -> str:
    return FIXTURE.read_text()


def test_leak_fixture_whole_document() -> None:
    md = _read_fixture()
    source = build_source(md)
    pdf = build_pdf(md)
    text = pdf_text(pdf)
    everything = pdf_everything(pdf)

    for marker in MARKERS:
        assert marker not in source, f"{marker} leaked into source"
        assert marker not in text, f"{marker} leaked into pdf_text"
        assert marker not in everything, f"{marker} leaked into pdf_everything"

    assert squash("Present perfect") in squash(text)
    assert squash("has lived") in squash(text)
    assert "a." in squash(text)
    assert "b." in squash(text)
    assert "c." in squash(text)
    assert "lives" in squash(text)


def test_leak_fixture_counts() -> None:
    md = _read_fixture()
    source = build_source(md)
    assert source.count("#box(width: 4em") == 4
    assert source.count("#pad(left: 2.7em)[#") == 3


@pytest.mark.anyio
async def test_leak_api_all_parts(client: httpx.AsyncClient) -> None:
    md = _read_fixture()

    resp = await client.post(
        "/api/export/plan",
        json={"markdown": md, "title": "Leak"},
    )
    assert resp.status_code == 200
    plan_text = resp.text
    for marker in MARKERS:
        assert marker not in plan_text, f"{marker} in plan JSON"

    parts: list[dict[str, object]] = cast(list[dict[str, object]], resp.json())

    student_parts = [p for p in parts if "student_pdf" in cast(list[str], p["targets"])]
    assert len(student_parts) == 2

    for part in student_parts:
        export_resp = await client.post(
            "/api/export",
            json={"markdown": md, "title": "Leak", "part": part["part"], "target": "student_pdf"},
        )
        assert export_resp.status_code == 200
        for marker in MARKERS:
            assert marker.encode() not in export_resp.content
            assert marker not in pdf_text(export_resp.content)
            assert marker not in pdf_everything(export_resp.content)
            headers_str = " ".join(f"{k}: {v}" for k, v in export_resp.headers.items())
            assert marker not in headers_str


def test_styled_blank_and_option() -> None:
    md = (
        'Fill [{{SECRETANSWER}}]{size=16} here.\n'
        '\n'
        'Pick:\n'
        '- [ ] [wrong]{font="Roboto" size=14}\n'
        '- [x] [right]{font="Roboto" size=14}\n'
    )
    source = build_source(md)
    pdf = build_pdf(md)
    text = pdf_text(pdf)
    everything = pdf_everything(pdf)

    assert "size: 16pt)[#box(width: 4em" in source
    assert "SECRETANSWER" not in source
    assert "SECRETANSWER" not in everything
    assert "wrong" in text
    assert "right" in text
    assert "[x]" not in source
    assert "\u2713" not in source


KINDS: tuple[str, ...] = (
    "heading",
    "paragraph",
    "ordered_blank",
    "blank_alt",
    "mcq",
    "teacher_note",
    "code_fence",
    "html_comment",
    "table_blank",
    "split_comment",
)

_LEAK_RE = re.compile(r"(ANS|ALT|NOTE|RAW|CMT|SPLIT|FONT|META)MARK_\d+")


def _build_doc(kinds: list[str], include_fm: bool) -> str:
    lines: list[str] = []
    if include_fm:
        lines.append("---")
        lines.append("zz_key: METAMARK_0")
        lines.append("---")
        lines.append("")

    k = 0
    seen_split = False
    for i, kind in enumerate(kinds):
        if kind == "heading":
            lines.append(f"## Heading w{i}")
            lines.append("")
        elif kind == "paragraph":
            lines.append(f"Plain text w{i}.")
            lines.append("")
        elif kind == "ordered_blank":
            lines.append(f"1. word w{i} {{{{ANSMARK_{k}}}}} here.")
            lines.append("")
            k += 1
        elif kind == "blank_alt":
            lines.append(f"{{{{ANSMARK_{k} | ALTMARK_{k}}}}}")
            lines.append("")
            k += 1
        elif kind == "mcq":
            lines.append(f"Question w{i}?")
            lines.append("")
            lines.append(f"- [ ] opt w{i}")
            lines.append(f"- [x] opt w{i}")
            lines.append(f"- [ ] opt w{i}")
            lines.append("")
            lines.append("::: teacher {tag=\"Distractors\"}")
            lines.append(f"NOTEMARK_{k} reasoning")
            lines.append(":::")
            lines.append("")
            k += 1
        elif kind == "teacher_note":
            lines.append("::: teacher {tag=\"CCQ\"}")
            lines.append(f"NOTEMARK_{k} [x]{{font=\"FONTMARK_{k}\" size=14}}")
            lines.append(":::")
            lines.append("")
            k += 1
        elif kind == "code_fence":
            lines.append("```")
            lines.append(f"RAWMARK_{k}")
            lines.append("```")
            lines.append("")
            k += 1
        elif kind == "html_comment":
            lines.append(f"<!-- CMTMARK_{k} -->")
            lines.append("")
            k += 1
        elif kind == "table_blank":
            lines.append("| Col |")
            lines.append("| --- |")
            lines.append(f"| {{{{ANSMARK_{k}}}}} |")
            lines.append("")
            k += 1
        elif kind == "split_comment":
            if not seen_split:
                lines.append(f"<!-- split: SPLITMARK_{k} -->")
                lines.append("")
                seen_split = True
                k += 1

    return "\n".join(lines)


def _expected_blanks(kinds: list[str]) -> int:
    count = 0
    for kind in kinds:
        if kind in ("ordered_blank", "blank_alt", "table_blank"):
            count += 1
    return count


@st.composite
def _doc_strategy(draw: st.DrawFn) -> str:
    kinds: list[str] = draw(st.lists(st.sampled_from(KINDS), max_size=8))
    include_fm: bool = draw(st.booleans())
    return _build_doc(kinds, include_fm)


@given(st.data())
@settings(max_examples=30, deadline=None)
def test_hypothesis_no_teacher_content(data: st.DataObject) -> None:
    kinds: list[str] = data.draw(st.lists(st.sampled_from(KINDS), max_size=8))
    include_fm: bool = data.draw(st.booleans())
    md = _build_doc(kinds, include_fm)
    source = build_source(md)
    pdf = build_pdf(md)
    text = pdf_text(pdf)
    everything = pdf_everything(pdf)

    assert not _LEAK_RE.search(source), f"leak in source: {_LEAK_RE.search(source)}"
    assert not _LEAK_RE.search(text), f"leak in pdf_text: {_LEAK_RE.search(text)}"
    assert not _LEAK_RE.search(everything), f"leak in pdf_everything: {_LEAK_RE.search(everything)}"

    expected = _expected_blanks(kinds)
    assert source.count("#box(width: 4em") == expected
