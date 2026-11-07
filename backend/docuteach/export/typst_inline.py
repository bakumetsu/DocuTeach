"""Turn student-safe inline nodes into Typst markup."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import cast

from docuteach.export.fonts import resolve_font, typst_font_arg
from docuteach.md.model import Meta, Style
from docuteach.md.project import StudentBlank, StudentInline, StudentText


def typst_string(s: str) -> str:
    """Return a Typst string literal (quoted, escaped) safe from markup injection."""
    out: list[str] = []
    for ch in s:
        code = ord(ch)
        if ch == "\\":
            out.append("\\\\")
        elif ch == '"':
            out.append('\\"')
        elif ch == "\n":
            out.append("\\n")
        elif ch == "\r":
            out.append("\\r")
        elif ch == "\t":
            out.append("\\t")
        elif code < 0x20 or 0x7F <= code <= 0x9F or code in (0x2028, 0x2029):
            out.append(f"\\u{{{code:x}}}")
        else:
            out.append(ch)
    return '"' + "".join(out) + '"'


@dataclass(frozen=True)
class PageStyle:
    font: str
    size: float
    line: float
    margins_mm: tuple[float, float, float, float]


DEFAULT_PAGE = PageStyle("Arial", 12.0, 1.65, (12.0, 15.0, 12.0, 15.0))


def read_page_style(meta: Meta) -> PageStyle:
    """Extract a PageStyle from Meta.data, falling back to DEFAULT_PAGE on any issue."""
    data = meta.data
    if not isinstance(data, dict):
        return DEFAULT_PAGE
    page_raw = data.get("page")
    if not isinstance(page_raw, dict):
        return DEFAULT_PAGE
    page = cast("dict[str, object]", page_raw)

    font = DEFAULT_PAGE.font
    size = DEFAULT_PAGE.size
    line = DEFAULT_PAGE.line
    margins = DEFAULT_PAGE.margins_mm

    f = page.get("font")
    if isinstance(f, str) and len(f) > 0:
        font = f

    s = page.get("size")
    if isinstance(s, (int, float)) and not isinstance(s, bool):
        if math.isfinite(s) and 8.0 <= s <= 24.0:
            size = float(s)

    line_raw = page.get("line")
    if isinstance(line_raw, (int, float)) and not isinstance(line_raw, bool):
        if 1.0 <= line_raw <= 3.0:
            line = float(line_raw)

    m_raw = page.get("margins_mm")
    if isinstance(m_raw, (list, tuple)):
        m: list[object] | tuple[object, ...] = cast(
            "list[object] | tuple[object, ...]", m_raw
        )
        if len(m) == 4:
            vals: list[float] = []
            ok = True
            for x in m:
                if isinstance(x, (int, float)) and not isinstance(x, bool) and 0.0 <= x <= 60.0:
                    vals.append(float(x))
                else:
                    ok = False
                    break
            if ok:
                margins = (vals[0], vals[1], vals[2], vals[3])

    return PageStyle(font=font, size=size, line=line, margins_mm=margins)


class InlineWriter:
    """Renders student-safe inline nodes into Typst markup strings."""

    def __init__(self, page_font: str) -> None:
        self.page_font = page_font
        self.warnings: list[str] = []
        self._warned: set[str] = set()

    def _warn(self, msg: str) -> None:
        if msg not in self._warned:
            self._warned.add(msg)
            self.warnings.append(msg)

    def emit(self, content: tuple[StudentInline, ...]) -> str:
        return "".join(self.emit_one(node) for node in content)

    def emit_one(self, node: StudentInline) -> str:
        if isinstance(node, StudentText):
            inner = "#" + typst_string(node.text)
            for mark in node.marks:
                if mark == "bold":
                    inner = f"#strong[{inner}]"
                elif mark == "italic":
                    inner = f"#emph[{inner}]"
                elif mark == "underline":
                    inner = f"#underline[{inner}]"
                elif mark == "highlight":
                    inner = f"#highlight[{inner}]"
            return self._style_wrap(node.style, inner)
        if isinstance(node, StudentBlank):
            inner = "#box(width: 4em, height: 1em, stroke: (bottom: 0.6pt))"
            return self._style_wrap(node.style, inner)
        return "#linebreak()"

    def _style_wrap(self, style: Style | None, inner: str) -> str:
        if style is None:
            return inner
        args: list[str] = []
        if style.font is not None:
            choice = resolve_font(style.font, self.page_font)
            if choice.warning is not None:
                self._warn(choice.warning)
            args.append("font: " + typst_font_arg(choice.stack))
        if style.size is not None:
            sv = style.size
            if sv == int(sv):
                size_str = str(int(sv))
            else:
                size_str = str(sv)
            args.append(f"size: {size_str}pt")
        if not args:
            return inner
        return f"#text({', '.join(args)})[{inner}]"
