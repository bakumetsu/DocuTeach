"""Teacher DOCX and answer key tests."""
# pyright: reportUnknownMemberType=false, reportPrivateUsage=false
from __future__ import annotations

import io
import zipfile
from pathlib import Path

import pytest
from docx import Document

from docuteach.export.answer_key import KeyLine, build_answer_key
from docuteach.export.docx_render import DocxResult, render_docx
from docuteach.export.typst_inline import PageStyle, read_page_style
from docuteach.md.model import Doc
from docuteach.md.parser import parse_markdown

_FIXTURE = Path(__file__).parent / "fixtures" / "leak.md"


def _model(md: str) -> tuple[Doc, PageStyle]:
    res = parse_markdown(md)
    return res.doc, read_page_style(res.doc.meta)


def _docx(md: str) -> DocxResult:
    doc, page = _model(md)
    return render_docx(doc, page)


def _xml(data: bytes) -> str:
    return zipfile.ZipFile(io.BytesIO(data)).read("word/document.xml").decode()


def _texts(data: bytes) -> list[str]:
    return [p.text for p in Document(io.BytesIO(data)).paragraphs]


def test_key_lines() -> None:
    md = (
        "# T\n\n## Part A\n\n"
        "1. She {{has lived | 's lived}} here.\n"
        "2. I {{am}} and you {{are}}.\n"
        "3. No blank here.\n\n"
        "## Part B\n\n"
        "Which one?\n"
        "- [ ] one\n"
        "- [x] two\n"
        "- [x] three\n"
    )
    doc, _ = _model(md)
    key = build_answer_key(doc)
    assert len(key.sections) == 2
    assert key.sections[0].heading == "Part A"
    assert key.sections[1].heading == "Part B"
    assert key.sections[0].lines == (
        KeyLine("1.1", "has lived / 's lived"),
        KeyLine("1.2", "am; are"),
    )
    assert key.sections[1].lines == (KeyLine("2.1", "b, c"),)
    assert key.other == ()
    assert key.warnings == ()


def test_key_warnings() -> None:
    md = "1. Empty {{}} gap.\n\nWhich?\n- [ ] a\n- [ ] b\n"
    doc, _ = _model(md)
    key = build_answer_key(doc)
    assert any(w.startswith("empty_answer:") for w in key.warnings)
    assert any(w.startswith("mcq_no_answer:") for w in key.warnings)
    assert key.sections[0].lines[1].text == "(no correct answer marked)"


def test_key_other_blanks() -> None:
    md = "Intro {{alpha}} text.\n\n- bullet {{beta}}\n"
    doc, _ = _model(md)
    key = build_answer_key(doc)
    assert key.sections == ()
    assert key.other == ("alpha", "beta")


def test_docx_is_valid_zip_and_has_key() -> None:
    md = (
        "# T\n\n## Part A\n\n"
        "1. She {{has lived | 's lived}} here.\n"
        "2. I {{am}} and you {{are}}.\n"
        "3. No blank here.\n\n"
        "## Part B\n\n"
        "Which one?\n"
        "- [ ] one\n"
        "- [x] two\n"
        "- [x] three\n"
    )
    result = _docx(md)
    texts = _texts(result.data)
    assert "Answer key" in texts
    assert "Part A" in texts
    assert any(t.startswith("1.1") and "has lived / 's lived" in t for t in texts)
    assert any(t.startswith("2.1") and t.endswith("b, c") for t in texts)
    ak_idx = texts.index("Answer key")
    she_idx = next(i for i, t in enumerate(texts) if "She" in t)
    assert ak_idx > she_idx


def test_docx_marks_fonts_and_sizes() -> None:
    md = 'Plain [big]{font="Roboto" size=14} and **bold**.'
    result = _docx(md)
    xml = _xml(result.data)
    assert 'w:ascii="Roboto"' in xml
    assert 'w:sz w:val="28"' in xml
    assert any(
        w.startswith("fonts_not_embedded:") and "Roboto" in w for w in result.warnings
    )
    result2 = _docx("Hello.")
    assert not any(w.startswith("fonts_not_embedded:") for w in result2.warnings)


def test_docx_unlisted_font_warning() -> None:
    md = '[x]{font="Comic Sans MS"}'
    result = _docx(md)
    assert "unlisted_font: Comic Sans MS" in result.warnings
    assert 'w:ascii="Comic Sans MS"' in _xml(result.data)


def test_docx_note_mcq_split_raw() -> None:
    leak = _FIXTURE.read_text(encoding="utf-8")
    result = _docx(leak)
    xml = _xml(result.data)
    assert "Teacher note · CCQ" in xml
    assert "Teacher note · Distractors" in xml
    assert 'w:fill="D1FAE5"' in xml
    assert "✓" in xml
    assert "✂ ZZ-SPLIT-7" in xml
    assert "Unsupported block (kept as written)" in xml
    assert len(Document(io.BytesIO(result.data)).tables) >= 3


def test_docx_has_every_leak_marker() -> None:
    leak = _FIXTURE.read_text(encoding="utf-8")
    result = _docx(leak)
    xml = _xml(result.data)
    for marker in ("ZZ-NOTE-1", "ZZ-ANS-2", "ZZ-ALT-3", "ZZ-DIST-4", "ZZ-RAW-5", "ZZ-SPLIT-7"):
        assert marker in xml, marker
    texts = _texts(result.data)
    ak_idx = texts.index("Answer key")
    key_text = " ".join(texts[ak_idx:])
    assert "ZZ-ANS-2 / ZZ-ALT-3" in key_text


def test_docx_empty_document() -> None:
    result = _docx("")
    texts = _texts(result.data)
    assert "No answers in this document." in texts


def test_docx_page_margins() -> None:
    md = (
        "---\n"
        "page: {font: Arial, size: 12, line: 1.65, margins_mm: [10, 20, 30, 40]}\n"
        "---\n\nHi.\n"
    )
    result = _docx(md)
    section = Document(io.BytesIO(result.data)).sections[0]
    assert section.top_margin is not None
    assert section.right_margin is not None
    assert section.bottom_margin is not None
    assert section.left_margin is not None
    assert section.page_width is not None
    assert section.top_margin.mm == pytest.approx(10, abs=0.1)
    assert section.right_margin.mm == pytest.approx(20, abs=0.1)
    assert section.bottom_margin.mm == pytest.approx(30, abs=0.1)
    assert section.left_margin.mm == pytest.approx(40, abs=0.1)
    assert section.page_width.mm == pytest.approx(210, abs=0.1)


def test_spec_ships_font_data() -> None:
    spec = (Path(__file__).resolve().parents[2] / "desktop" / "DocuTeach.spec").read_text(
        encoding="utf-8"
    )
    assert "export" in spec
    assert "fonts" in spec
    assert "fonts.json" in spec
    assert 'collect_data_files("docx")' in spec
