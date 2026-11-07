from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from docuteach.export.fonts import resolve_font, typst_font_arg
from docuteach.export.names import content_disposition, sanitize_filename
from docuteach.export.split import split_index
from docuteach.export.typst_inline import PageStyle
from docuteach.export.typst_render import compile_pdf, render_source, student_labels
from docuteach.md.fonts import FONTS
from docuteach.md.model import Style
from docuteach.md.numbering import number_questions
from docuteach.md.project import (
    StudentDoc,
    StudentHeading,
    StudentMcq,
    StudentOption,
    StudentParagraph,
    StudentTable,
    StudentTableCell,
    StudentText,
)
from tests.export_helpers import (
    build_pdf,
    build_source,
    pdf_fonts,
    pdf_page_count,
    pdf_text,
    squash,
    student_doc,
)

_FIXTURES_DIR: Path = Path(__file__).resolve().parents[2] / "frontend" / "test" / "fixtures"
_FONTS_JSON: Path = (
    Path(__file__).resolve().parents[2] / "frontend" / "src" / "editor" / "fonts.json"
)

DEFAULT_PAGE: PageStyle = PageStyle(
    font="Arial", size=12.0, line=1.5, margins_mm=(20.0, 20.0, 20.0, 20.0)
)

INJECTION_PAYLOADS: tuple[str, ...] = (
    '#read("C:/secret")',
    '#include "x.typ"',
    "$x^2$ and @ref and *bold* and _it_",
    "\\ \" ' [ ] { } ( ) # ~ - + / =",
    "`code`",
    '#import "@preview/x:0.1.0"',
    "<label> //comment /* c */",
)

HOSTILE_FONT_NAME: str = 'x"); #read("C:/secret"); ('


# ---------------------------------------------------------------------------
# 1. names
# ---------------------------------------------------------------------------


def test_sanitize_filename_basic() -> None:
    assert (
        sanitize_filename("Unit 3: Past / Present?", "Lesson", "student")
        == "Unit 3 Past Present - Lesson - student.pdf"
    )


def test_sanitize_filename_reserved_con() -> None:
    result = sanitize_filename("CON", "Lesson", "student")
    assert result.startswith("_CON")


def test_sanitize_filename_long_title() -> None:
    long_title = "x" * 200
    result = sanitize_filename(long_title, "Lesson", "student")
    stem = result.rsplit(".", 1)[0]
    assert len(stem) <= 80


def test_sanitize_filename_trailing_dot_space() -> None:
    result = sanitize_filename("a. ", "Lesson", "student")
    stem = result.rsplit(".", 1)[0]
    assert not stem.endswith(".")
    assert not stem.endswith(" ")


def test_sanitize_filename_teacher_ext() -> None:
    result = sanitize_filename("My Topic", "Lesson", "teacher")
    assert result.endswith(".docx")


def test_content_disposition_ascii_fallback() -> None:
    result = content_disposition("Bài học - Lesson - student.pdf")
    assert 'filename="' in result
    assert "filename*=UTF-8''B%C3%A0i" in result
    assert all(ord(ch) < 128 for ch in result)


# ---------------------------------------------------------------------------
# 2. fonts parity
# ---------------------------------------------------------------------------


@pytest.mark.skipif(not _FONTS_JSON.is_file(), reason="frontend fonts.json not found")
def test_fonts_parity_with_frontend() -> None:
    data: list[dict[str, str]] = json.loads(_FONTS_JSON.read_text(encoding="utf-8"))
    frontend: list[tuple[str, str]] = [(e["name"], e["kind"]) for e in data]
    backend: list[tuple[str, str]] = [(e["name"], e["kind"]) for e in FONTS]
    assert frontend == backend


# ---------------------------------------------------------------------------
# 3. fonts resolve
# ---------------------------------------------------------------------------


def test_resolve_font_arial() -> None:
    assert resolve_font("Arial", "Arial").stack == ("Arial", "Liberation Sans")


def test_resolve_font_merriweather() -> None:
    choice = resolve_font("merriweather", "Arial")
    assert choice.stack == ("Merriweather", "Noto Serif")
    assert choice.warning is None


def test_resolve_font_none_fallback() -> None:
    assert resolve_font(None, "Times New Roman").stack == (
        "Times New Roman",
        "Liberation Serif",
    )


def test_resolve_font_unlisted_comic_sans() -> None:
    choice = resolve_font("Comic Sans MS", "Arial")
    assert choice.warning == "unlisted_font: Comic Sans MS"
    assert "Liberation Sans" in choice.stack
    assert "Comic Sans MS" not in choice.stack


def test_resolve_font_hostile_name() -> None:
    choice = resolve_font(HOSTILE_FONT_NAME, "Arial")
    assert choice.warning is not None
    assert HOSTILE_FONT_NAME not in choice.stack


def test_typst_font_arg_escapes_quote() -> None:
    assert typst_font_arg(("a\"b", "Noto Sans")) == '("a\\"b", "Noto Sans")'


# ---------------------------------------------------------------------------
# 4. labels parity with fixtures
# ---------------------------------------------------------------------------


@pytest.mark.skipif(not _FIXTURES_DIR.is_dir(), reason="frontend fixtures folder missing")
@pytest.mark.parametrize("fixture", ["full-lesson.md", "lists.md", "mcq.md"])
def test_labels_parity(fixture: str) -> None:
    fixture_path = _FIXTURES_DIR / fixture
    if not fixture_path.is_file():
        pytest.skip(f"{fixture} not present in fixtures folder")
    md = fixture_path.read_text(encoding="utf-8")
    res, sdoc, _ = student_doc(md)
    labels: dict[int, tuple[str, ...]] = student_labels(sdoc)
    flat: list[str] = [lbl for idx in sorted(labels) for lbl in labels[idx]]
    teacher_labels: list[str] = [q.label for q in number_questions(res.doc)]
    assert flat == teacher_labels


# ---------------------------------------------------------------------------
# 5. injection
# ---------------------------------------------------------------------------


def _make_injection_doc(payload: str) -> StudentDoc:
    blocks = (
        StudentParagraph(content=(StudentText(text=payload),), align="left"),
        StudentHeading(level=2, content=(StudentText(text=payload),), align="left"),
        StudentTable(
            rows=((StudentTableCell(content=(StudentText(text=payload),), header=False),),),
        ),
        StudentMcq(
            question=(StudentText(text="Q"),),
            options=(StudentOption(content=(StudentText(text=payload),), letter="a"),),
            multi=False,
        ),
    )
    return StudentDoc(blocks=blocks)


@pytest.mark.parametrize("payload", INJECTION_PAYLOADS)
def test_injection_payload_roundtrip(payload: str) -> None:
    sdoc = _make_injection_doc(payload)
    result = render_source(sdoc, DEFAULT_PAGE)
    pdf = compile_pdf(result.source)
    assert squash(payload) in squash(pdf_text(pdf))


def test_injection_hostile_font_style() -> None:
    hostile = HOSTILE_FONT_NAME
    sdoc = StudentDoc(
        blocks=(
            StudentParagraph(
                content=(
                    StudentText(
                        text=hostile,
                        style=Style(font=hostile, size=14.0),
                    ),
                ),
                align="left",
            ),
        )
    )
    result = render_source(sdoc, DEFAULT_PAGE)
    pdf = compile_pdf(result.source)
    assert squash(hostile) in squash(pdf_text(pdf))


# ---------------------------------------------------------------------------
# 6. blanks
# ---------------------------------------------------------------------------


def test_blanks_uniform_rendering() -> None:
    md = "She {{a}} and {{bbbbbbbbbbbbbbbbbbbbbbbbbbbb}} and {{c | d}}."
    source = build_source(md)
    count = source.count("#box(width: 4em")
    assert count == 3
    matches = re.findall(r"#box\(width: 4em[^)]*\)", source)
    assert len(matches) == 3
    assert all(m == matches[0] for m in matches)


# ---------------------------------------------------------------------------
# 7. Vietnamese
# ---------------------------------------------------------------------------


def test_vietnamese_roundtrip() -> None:
    text = "Tiếng Việt: ặ ế ỡ ữ ở"
    pdf = build_pdf(text)
    assert squash(text) in squash(pdf_text(pdf))


# ---------------------------------------------------------------------------
# 8. font in the PDF
# ---------------------------------------------------------------------------


def test_pdf_font_be_vietnam_pro() -> None:
    pdf = build_pdf('[Hello]{font="Be Vietnam Pro" size=18}')
    fonts = pdf_fonts(pdf)
    assert any("BeVietnamPro" in name for name in fonts)


def test_pdf_font_times_new_roman() -> None:
    pdf = build_pdf('[Hello]{font="Times New Roman"}')
    fonts = pdf_fonts(pdf)
    assert any("Times" in name or "Liberation" in name for name in fonts)


@pytest.mark.parametrize("name", [e["name"] for e in FONTS])
def test_pdf_every_font_vietnamese(name: str) -> None:
    text = "Tiếng Việt: ặ ế ỡ ữ ở"
    pdf = build_pdf(f'[{text}]{{font="{name}"}}')
    assert squash(text) in squash(pdf_text(pdf))


@pytest.mark.parametrize(
    "name", ["Roboto", "Open Sans", "Source Sans 3", "Merriweather"]
)
def test_pdf_variable_fonts_bold_italic(name: str) -> None:
    pdf = build_pdf(f'[**Bold** *Ital* Plain]{{font="{name}"}}')
    assert squash("Bold Ital Plain") in squash(pdf_text(pdf))
    family = name.replace(" ", "")
    assert any(family in n for n in pdf_fonts(pdf))


# ---------------------------------------------------------------------------
# 9. empty document
# ---------------------------------------------------------------------------


def test_empty_document_warning() -> None:
    _, sdoc, page = student_doc("")
    result = render_source(sdoc, page)
    assert any(w.startswith("empty_document") for w in result.warnings)


def test_empty_document_page_count() -> None:
    assert pdf_page_count(build_pdf("")) == 1


# ---------------------------------------------------------------------------
# 10. MCQ
# ---------------------------------------------------------------------------


def test_mcq_single_choice() -> None:
    md = (
        "Which one?\n"
        "- [ ] lives\n"
        "- [x] has lived\n"
        "- [ ] is living\n"
    )
    pdf = build_pdf(md)
    text = pdf_text(pdf)
    assert "a." in text
    assert "b." in text
    assert "c." in text
    assert "correct" not in text.lower()
    assert "✓" not in text


def test_mcq_multi_choice() -> None:
    md = (
        "Pick all.\n"
        "- [x] alpha\n"
        "- [x] beta\n"
        "- [ ] gamma\n"
    )
    pdf = build_pdf(md)
    text = pdf_text(pdf)
    assert "(choose all that apply)" in text


# ---------------------------------------------------------------------------
# 11. part numbering
# ---------------------------------------------------------------------------


def test_part_numbering_split() -> None:
    md = "1. first {{a}}\n2. second {{b}}\n\n<!-- split: Homework starts here -->\n\n3. third {{c}}"
    _, sdoc, page = student_doc(md)
    k = split_index(sdoc)
    assert k is not None
    result = render_source(sdoc, page, k + 1, None)
    assert '#"3."' in result.source
    assert "first" not in result.source


def test_mcq_explanation_note_not_in_student_pdf() -> None:
    md = (
        "Which one?\n"
        "- [ ] lives\n"
        "- [x] has lived\n"
        "\n"
        "::: teacher\n"
        "ZZ-EXPLAIN-9 because of the present perfect.\n"
        ":::\n"
    )
    text = pdf_text(build_pdf(md))
    assert "ZZ-EXPLAIN-9" not in text
    assert "✓" not in text


def test_paragraph_gap_fill_label_in_source() -> None:
    md = "## A\n\n1. I {{am}}.\n2. You {{are}}.\n\nShe {{is}} happy.\n"
    _, sdoc, _ = student_doc(md)
    src = render_source(sdoc, DEFAULT_PAGE).source
    assert '"3."' in src
    assert "2.1" not in src
