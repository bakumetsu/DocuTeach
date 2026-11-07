"""Table alignment: parser, Typst, and DOCX output."""

from __future__ import annotations

import io
import re
import zipfile

from docx import Document

from docuteach.export.docx_render import render_docx
from docuteach.export.typst_inline import read_page_style
from docuteach.md.model import Table, to_json
from docuteach.md.parser import parse_markdown
from tests.export_helpers import build_pdf, build_source, pdf_text


def test_table_aligns_from_separator_row() -> None:
    doc, _ = parse_markdown("| a | b | c | d |\n| :--- | :---: | ---: | --- |\n| 1 | 2 | 3 | 4 |\n")
    table = doc.blocks[0]
    assert isinstance(table, Table)
    assert table.aligns == ("left", "center", "right", None)


def test_table_without_alignment_has_no_aligns() -> None:
    doc, _ = parse_markdown("| a | b |\n| --- | --- |\n| 1 | 2 |\n")
    table = doc.blocks[0]
    assert isinstance(table, Table)
    assert table.aligns == ()
    assert "aligns" not in to_json(table)  # type: ignore[operator]


def test_typst_columns_align_header() -> None:
    source = build_source("| Tense | Example |\n| :--- | ---: |\n| Past | She lived. |\n")
    assert "table.header(" in source
    assert re.search(r"columns: \([\d.]+fr, [\d.]+fr\)", source)
    assert "align: (left, right)" in source


def test_student_pdf_table_hides_answers() -> None:
    pdf = build_pdf("| A | B |\n| --- | :---: |\n| x | She {{has lived}} here. |\n")
    assert "has lived" not in pdf_text(pdf)


def test_docx_table_header_widths_shading_align() -> None:
    res = parse_markdown("| Tense | Example |\n| :--- | ---: |\n| Past | She {{lived}}. |\n")
    data = render_docx(res.doc, read_page_style(res.doc.meta)).data
    xml = zipfile.ZipFile(io.BytesIO(data)).read("word/document.xml").decode()
    assert len(Document(io.BytesIO(data)).tables) == 1
    assert "<w:tblHeader" in xml
    assert "<w:cantSplit" in xml
    assert 'w:fill="F3F4F6"' in xml
    assert "<w:tcW" in xml
    assert 'w:val="right"' in xml
