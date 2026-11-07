"""Tests for font helpers and span syntax in the markdown parser."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from docuteach.md.fonts import FONTS, valid_font_name, valid_size
from docuteach.md.model import Blank, Doc, Paragraph, Style, Text
from docuteach.md.parser import parse_markdown

FIXTURES = Path(__file__).resolve().parents[2] / "frontend" / "test" / "fixtures"
GOLDEN = Path(__file__).parent / "golden"


def _skip_if_no_fixtures() -> None:
    if not FIXTURES.exists():
        pytest.skip("frontend fixtures not found")


def _paragraph(doc: Doc) -> Paragraph:
    assert len(doc.blocks) == 1
    block = doc.blocks[0]
    assert isinstance(block, Paragraph)
    return block


# ---------------------------------------------------------------------------
# valid_font_name
# ---------------------------------------------------------------------------


class TestValidFontName:
    @pytest.mark.parametrize(
        "name",
        ["Roboto", "Be Vietnam Pro", "Tiếng Việt", "Source Sans 3"],
    )
    def test_accepts_valid(self, name: str) -> None:
        assert valid_font_name(name) is True

    def test_rejects_empty(self) -> None:
        assert valid_font_name("") is False

    def test_rejects_41_chars(self) -> None:
        assert valid_font_name("a" * 41) is False

    def test_rejects_semicolon_url(self) -> None:
        assert valid_font_name("x;background:url(http://a)") is False

    def test_rejects_double_quote(self) -> None:
        assert valid_font_name('a"b') is False

    def test_rejects_parens(self) -> None:
        assert valid_font_name("a(b)") is False

    def test_rejects_slash(self) -> None:
        assert valid_font_name("a/b") is False

    def test_rejects_comma(self) -> None:
        assert valid_font_name("a,b") is False

    def test_rejects_single_quote(self) -> None:
        assert valid_font_name("a'b") is False

    def test_rejects_backslash(self) -> None:
        assert valid_font_name("a\\b") is False


# ---------------------------------------------------------------------------
# valid_size
# ---------------------------------------------------------------------------


class TestValidSize:
    @pytest.mark.parametrize("size", [6.0, 6.5, 10.5, 72.0])
    def test_accepts_valid(self, size: float) -> None:
        assert valid_size(size) is True

    @pytest.mark.parametrize(
        "size", [5.5, 5.0, 72.5, 13.3, 999.0, float("nan"), float("inf")]
    )
    def test_rejects_invalid(self, size: float) -> None:
        assert valid_size(size) is False


# ---------------------------------------------------------------------------
# Span syntax via parse_markdown
# ---------------------------------------------------------------------------


class TestSpanSyntax:
    def test_font_and_size(self) -> None:
        doc, warnings = parse_markdown('[x]{font="Roboto" size=15}')
        assert warnings == ()
        p = _paragraph(doc)
        assert len(p.content) == 1
        node = p.content[0]
        assert isinstance(node, Text)
        assert node.text == "x"
        assert node.style == Style(font="Roboto", size=15.0)
        assert node.marks == ()

    def test_size_with_underline_mark(self) -> None:
        doc, warnings = parse_markdown("[x]{size=14 .u}")
        assert warnings == ()
        p = _paragraph(doc)
        assert len(p.content) == 1
        node = p.content[0]
        assert isinstance(node, Text)
        assert node.text == "x"
        assert node.style == Style(font=None, size=14.0)
        assert node.marks == ("underline",)

    def test_underline_mark_with_font(self) -> None:
        doc, warnings = parse_markdown('[x]{.u font="Roboto"}')
        assert warnings == ()
        p = _paragraph(doc)
        assert len(p.content) == 1
        node = p.content[0]
        assert isinstance(node, Text)
        assert node.text == "x"
        assert node.style == Style(font="Roboto", size=None)
        assert node.marks == ("underline",)

    def test_lowercase_font_kept_as_written(self) -> None:
        doc, warnings = parse_markdown('[x]{font="roboto" size=15}')
        assert warnings == ()
        p = _paragraph(doc)
        assert len(p.content) == 1
        node = p.content[0]
        assert isinstance(node, Text)
        assert node.style == Style(font="roboto", size=15.0)

    @pytest.mark.parametrize(
        "source",
        [
            '[x]{font="A" size=999}',
            "[x]{size=13.3}",
            "[x]{size=5}",
            "[x]{size=big}",
            "[x]{color=red}",
            "[x]{font=Roboto}",
            '[x]{font="x;background:url(http://a)"}',
        ],
    )
    def test_invalid_span_is_literal_text_with_warning(self, source: str) -> None:
        doc, warnings = parse_markdown(source)
        assert "unsupported_style" in warnings
        p = _paragraph(doc)
        assert len(p.content) == 1
        node = p.content[0]
        assert isinstance(node, Text)
        assert node.style is None
        assert node.text == source

    def test_escaped_span_is_plain_text(self) -> None:
        doc, warnings = parse_markdown(r"\[x\]{size=14}")
        assert warnings == ()
        p = _paragraph(doc)
        assert len(p.content) == 1
        node = p.content[0]
        assert isinstance(node, Text)
        assert node.style is None
        assert node.text == "[x]{size=14}"

    def test_blank_in_style_span(self) -> None:
        doc, warnings = parse_markdown("[{{has lived}}]{size=16}")
        assert warnings == ()
        p = _paragraph(doc)
        assert len(p.content) == 1
        node = p.content[0]
        assert isinstance(node, Blank)
        assert node.style == Style(font=None, size=16.0)

    def test_unlisted_font_warns_once(self) -> None:
        source = 'a [x]{font="Comic Sans MS"} b [y]{font="Comic Sans MS"}'
        doc, warnings = parse_markdown(source)
        assert warnings.count("unlisted_font: Comic Sans MS") == 1
        p = _paragraph(doc)
        assert any(
            isinstance(node, Text)
            and node.style == Style(font="Comic Sans MS", size=None)
            for node in p.content
        )

    def test_listed_font_no_warning(self) -> None:
        _, warnings = parse_markdown('[x]{font="Roboto" size=15}')
        assert warnings == ()


# ---------------------------------------------------------------------------
# FONTS matches frontend JSON
# ---------------------------------------------------------------------------


class TestFontsJson:
    def test_fonts_json_matches_frontend(self) -> None:
        _skip_if_no_fixtures()
        fonts_path = (
            Path(__file__).resolve().parents[2]
            / "frontend"
            / "src"
            / "editor"
            / "fonts.json"
        )
        if not fonts_path.exists():
            pytest.skip("frontend fonts.json not found")
        with fonts_path.open(encoding="utf-8") as f:
            expected = json.load(f)
        assert FONTS == expected
