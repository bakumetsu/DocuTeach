"""Font resolution and Typst font-argument generation for DocuTeach export."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from ..md.fonts import FONTS, canonical_font, valid_font_name

FONTS_DIR: Path = Path(__file__).with_name("fonts")

_PAGE_EXTRA: tuple[str, ...] = ("Tahoma", "Verdana", "Calibri", "Cambria")

PAGE_FONTS: frozenset[str] = (
    frozenset(str(entry["name"]) for entry in FONTS) | frozenset(_PAGE_EXTRA)
)

_SIBLING: dict[str, str] = {
    "Arial": "Liberation Sans",
    "Times New Roman": "Liberation Serif",
    "Tahoma": "Noto Sans",
    "Verdana": "Noto Sans",
    "Calibri": "Noto Sans",
    "Cambria": "Noto Serif",
    "Noto Sans Mono": "Noto Sans Mono",
    "Merriweather": "Noto Serif",
    "Noto Serif": "Noto Serif",
    "Noto Sans": "Noto Sans",
    "Roboto": "Noto Sans",
    "Open Sans": "Noto Sans",
    "Source Sans 3": "Noto Sans",
    "Be Vietnam Pro": "Noto Sans",
}


@dataclass(frozen=True)
class FontChoice:
    stack: tuple[str, ...]
    warning: str | None


def sibling_of(name: str) -> str:
    return _SIBLING.get(canonical_font(name), "Noto Sans")


def resolve_font(name: str | None, page_font: str) -> FontChoice:
    if name is None:
        pf = canonical_font(page_font)
        if pf in PAGE_FONTS:
            sib = sibling_of(pf)
            stack = (pf, sib) if sib != pf else (pf,)
            return FontChoice(stack=stack, warning=None)
        return FontChoice(stack=("Noto Sans",), warning=None)

    if valid_font_name(name):
        canonical = canonical_font(name)
        if canonical in PAGE_FONTS:
            sib = sibling_of(canonical)
            stack = (canonical, sib) if sib != canonical else (canonical,)
            return FontChoice(stack=stack, warning=None)

    pf = canonical_font(page_font)
    if pf in PAGE_FONTS:
        stack = (sibling_of(pf),)
    else:
        stack = ("Noto Sans",)
    return FontChoice(stack=stack, warning=f"unlisted_font: {name}")


def _typst_escape(name: str) -> str:
    out: list[str] = []
    for ch in name:
        if ch == "\\":
            out.append("\\\\")
        elif ch == '"':
            out.append('\\"')
        elif ord(ch) < 0x20:
            out.append(f"\\u{{{ord(ch):x}}}")
        else:
            out.append(ch)
    return "".join(out)


def typst_font_arg(stack: tuple[str, ...]) -> str:
    if len(stack) == 1:
        return f'("{_typst_escape(stack[0])}",)'
    return "(" + ", ".join(f'"{_typst_escape(s)}"' for s in stack) + ")"
