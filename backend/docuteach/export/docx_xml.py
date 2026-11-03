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

_PPR_AFTER_SHD = (
    "w:tabs", "w:suppressAutoHyphens", "w:kinsoku", "w:wordWrap",
    "w:overflowPunct", "w:topLinePunct", "w:autoSpaceDE", "w:autoSpaceDN",
    "w:bidi", "w:adjustRightInd", "w:snapToGrid", "w:spacing", "w:ind",
    "w:contextualSpacing", "w:mirrorIndents", "w:suppressOverlap", "w:jc",
    "w:textDirection", "w:textAlignment", "w:textboxTightWrap",
    "w:outlineLvl", "w:divId", "w:cnfStyle", "w:rPr", "w:sectPr", "w:pPrChange",
)
_TCPR_AFTER_SHD = (
    "w:noWrap", "w:tcMar", "w:textDirection", "w:tcFitText", "w:vAlign", "w:hideMark",
)


def set_rfonts(rpr: BaseOxmlElement, name: str) -> None:
    """Set all four font-name attributes on *rpr*."""
    rfonts = rpr.get_or_add_rFonts()
    rfonts.set(qn("w:ascii"), name)
    rfonts.set(qn("w:hAnsi"), name)
    rfonts.set(qn("w:cs"), name)
    rfonts.set(qn("w:eastAsia"), name)


def set_size(rpr: BaseOxmlElement, size_pt: float) -> None:
    """Set w:sz and w:szCs to the half-point value for *size_pt*."""
    val = str(round(size_pt * 2))
    sz = rpr.get_or_add_sz()
    sz.set(qn("w:val"), val)
    szcs = rpr.find(qn("w:szCs"))
    if szcs is None:
        szcs = OxmlElement("w:szCs")
        sz.addnext(szcs)
    szcs.set(qn("w:val"), val)


def style_run(run: Run, font: str | None, size_pt: float | None) -> None:
    """Apply font name and/or size to *run* when the value is not None."""
    rpr = run._r.get_or_add_rPr()
    if font is not None:
        set_rfonts(rpr, font)
    if size_pt is not None:
        set_size(rpr, size_pt)


def shade(el: BaseOxmlElement, fill: str) -> None:
    """Append a w:shd child to *el* (a w:pPr or w:tcPr element)."""
    for old in el.findall(qn("w:shd")):
        el.remove(old)
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill)
    successors = _PPR_AFTER_SHD if el.tag == qn("w:pPr") else _TCPR_AFTER_SHD
    el.insert_element_before(shd, *successors)


def paragraph_shade(p: Paragraph, fill: str) -> None:
    """Shade the background of paragraph *p*."""
    shade(p._p.get_or_add_pPr(), fill)


def cell_shade(cell: _Cell, fill: str) -> None:
    """Shade the background of table cell *cell*."""
    shade(cell._tc.get_or_add_tcPr(), fill)


def bottom_border(p: Paragraph, color: str) -> None:
    """Add a single bottom border to paragraph *p*."""
    ppr = p._p.get_or_add_pPr()
    for old in ppr.findall(qn("w:pBdr")):
        ppr.remove(old)
    pbdr = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), "4")
    bottom.set(qn("w:space"), "1")
    bottom.set(qn("w:color"), color)
    pbdr.append(bottom)
    ppr.insert_element_before(pbdr, "w:shd", *_PPR_AFTER_SHD)


def cell_borders(cell: _Cell, color: str) -> None:
    """Add single borders on all four sides of *cell*."""
    tcpr = cell._tc.get_or_add_tcPr()
    for old in tcpr.findall(qn("w:tcBorders")):
        tcpr.remove(old)
    borders = OxmlElement("w:tcBorders")
    for side in ("top", "left", "bottom", "right"):
        el = OxmlElement(f"w:{side}")
        el.set(qn("w:val"), "single")
        el.set(qn("w:sz"), "8")
        el.set(qn("w:color"), color)
        borders.append(el)
    tcpr.insert_element_before(borders, "w:shd", *_TCPR_AFTER_SHD)


def hanging(p: Paragraph, left_cm: float, first_cm: float) -> None:
    """Give *p* a hanging indent (left *left_cm*, first-line *−first_cm*)."""
    p.paragraph_format.left_indent = Cm(left_cm)
    p.paragraph_format.first_line_indent = Cm(-first_cm)


def hex_color(s: str) -> RGBColor:
    """Convert a hex string like ``"FF0000"`` to an :class:`RGBColor`."""
    return RGBColor.from_string(s)
