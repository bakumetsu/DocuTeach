"""Low-level WordprocessingML helpers for the teacher DOCX."""
# python-docx's XML layer is untyped, so these rules are off for this module only.
# pyright: reportUnknownMemberType=false, reportUnknownVariableType=false
# pyright: reportPrivateUsage=false
from __future__ import annotations

from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.oxml.xmlchemy import BaseOxmlElement
from docx.shared import Cm, RGBColor
from docx.table import _Cell
from docx.text.paragraph import Paragraph
from docx.text.run import Run


def set_rfonts(rpr: BaseOxmlElement, name: str) -> None:
    """Set all four font-name attributes on *rpr*."""
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.append(rfonts)
    rfonts.set(qn("w:ascii"), name)
    rfonts.set(qn("w:hAnsi"), name)
    rfonts.set(qn("w:cs"), name)
    rfonts.set(qn("w:eastAsia"), name)


def set_size(rpr: BaseOxmlElement, size_pt: float) -> None:
    """Set w:sz and w:szCs to the half-point value for *size_pt*."""
    val = str(round(size_pt * 2))
    for tag in ("w:sz", "w:szCs"):
        el = rpr.find(qn(tag))
        if el is None:
            el = OxmlElement(tag)
            rpr.append(el)
        el.set(qn("w:val"), val)


def style_run(run: Run, font: str | None, size_pt: float | None) -> None:
    """Apply font name and/or size to *run* when the value is not None."""
    rpr = run._r.get_or_add_rPr()
    if font is not None:
        set_rfonts(rpr, font)
    if size_pt is not None:
        set_size(rpr, size_pt)


def shade(el: BaseOxmlElement, fill: str) -> None:
    """Append a w:shd child to *el* (a w:pPr or w:tcPr element)."""
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill)
    el.append(shd)


def paragraph_shade(p: Paragraph, fill: str) -> None:
    """Shade the background of paragraph *p*."""
    shade(p._p.get_or_add_pPr(), fill)


def cell_shade(cell: _Cell, fill: str) -> None:
    """Shade the background of table cell *cell*."""
    shade(cell._tc.get_or_add_tcPr(), fill)


def bottom_border(p: Paragraph, color: str) -> None:
    """Add a single bottom border to paragraph *p*."""
    ppr = p._p.get_or_add_pPr()
    pbdr = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), "4")
    bottom.set(qn("w:space"), "1")
    bottom.set(qn("w:color"), color)
    pbdr.append(bottom)
    ppr.append(pbdr)


def cell_borders(cell: _Cell, color: str) -> None:
    """Add single borders on all four sides of *cell*."""
    tcpr = cell._tc.get_or_add_tcPr()
    borders = OxmlElement("w:tcBorders")
    for side in ("top", "left", "bottom", "right"):
        el = OxmlElement(f"w:{side}")
        el.set(qn("w:val"), "single")
        el.set(qn("w:sz"), "8")
        el.set(qn("w:color"), color)
        borders.append(el)
    tcpr.append(borders)


def hanging(p: Paragraph, left_cm: float, first_cm: float) -> None:
    """Give *p* a hanging indent (left *left_cm*, first-line *−first_cm*)."""
    p.paragraph_format.left_indent = Cm(left_cm)
    p.paragraph_format.first_line_indent = Cm(-first_cm)


def hex_color(s: str) -> RGBColor:
    """Convert a hex string like ``"FF0000"`` to an :class:`RGBColor`."""
    return RGBColor.from_string(s)
