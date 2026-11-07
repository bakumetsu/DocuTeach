"""Inline runs for the teacher DOCX."""

from __future__ import annotations

from docx.enum.text import WD_COLOR_INDEX
from docx.text.paragraph import Paragraph

from docuteach.export.docx_xml import hex_color, style_run
from docuteach.export.fonts import PAGE_FONTS
from docuteach.export.typst_inline import PageStyle
from docuteach.md.fonts import FONTS, canonical_font, valid_font_name
from docuteach.md.model import Blank, Inline, Style, Text

_FONT_SET = frozenset(entry["name"] for entry in FONTS)
_BASE = {"Arial", "Times New Roman"}


class RunWriter:
    """Writes inline content into a python-docx paragraph, tracking fonts."""

    def __init__(self, page: PageStyle) -> None:
        self.page = page
        self.bundled_used: set[str] = set()
        self.unlisted: list[str] = []
        self._record(page.font)

    def _record(self, name: str | None) -> str | None:
        if name is None or not valid_font_name(name):
            return None
        canon = canonical_font(name)
        if canon in _FONT_SET and canon not in _BASE:
            self.bundled_used.add(canon)
        elif canon not in PAGE_FONTS:
            if canon not in self.unlisted:
                self.unlisted.append(canon)
        return canon

    def font_for(self, style: Style | None) -> str | None:
        if style and style.font:
            return self._record(style.font)
        return None

    def add(
        self,
        p: Paragraph,
        content: tuple[Inline, ...],
        *,
        size: float | None = None,
        bold: bool = False,
    ) -> None:
        for node in content:
            if isinstance(node, Text):
                self._add_text(p, node, size, bold)
            elif isinstance(node, Blank):
                self._add_blank(p, node, size)
            else:
                p.add_run().add_break()

    def _add_text(
        self, p: Paragraph, node: Text, size: float | None, bold: bool
    ) -> None:
        run = p.add_run(node.text)
        if "bold" in node.marks or bold:
            run.bold = True
        if "italic" in node.marks:
            run.italic = True
        if "underline" in node.marks:
            run.underline = True
        if "highlight" in node.marks:
            run.font.highlight_color = WD_COLOR_INDEX.YELLOW
        sz = node.style.size if node.style and node.style.size else size
        style_run(run, self.font_for(node.style), sz)

    def _add_blank(self, p: Paragraph, node: Blank, size: float | None) -> None:
        empty = not node.answers or node.answers[0].strip() == ""
        sz = node.style.size if node.style and node.style.size else size
        font = self.font_for(node.style)
        if empty:
            run = p.add_run("(empty)")
            run.font.color.rgb = hex_color("6B7280")
            style_run(run, font, sz)
        else:
            run = p.add_run(node.answers[0])
            run.bold = True
            run.font.color.rgb = hex_color("0F766E")
            style_run(run, font, sz)
            for alt in node.answers[1:]:
                r = p.add_run(f" / {alt}")
                r.font.color.rgb = hex_color("6B7280")
                style_run(r, font, sz)
