"""Inline token conversion ported from frontend/src/markdown/inline.ts."""

from __future__ import annotations

from collections import Counter
from typing import cast

from markdown_it.token import Token

from docuteach.md.fonts import FONTS
from docuteach.md.model import Blank, Break, Inline, Style, Text

_CANONICAL_MARK_ORDER: tuple[str, ...] = ("bold", "italic", "underline", "highlight")

_CLASS_TO_MARK: dict[str, str] = {
    "u": "underline",
    "b": "bold",
    "i": "italic",
    "hl": "highlight",
}

_FONT_NAMES: set[str] = {cast(str, entry["name"]).lower() for entry in FONTS}


def _canonical_marks(active: Counter[str]) -> tuple[str, ...]:
    """Return active marks in canonical order with no duplicates."""
    return tuple(m for m in _CANONICAL_MARK_ORDER if active[m] > 0)


def _make_style(font: str | None, size: float | None) -> Style | None:
    """Create a Style, or None when both font and size are None."""
    if font is None and size is None:
        return None
    return Style(font=font, size=size)


def inline_to_nodes(
    children: list[Token] | None,
    *,
    warnings: list[str] | None = None,
) -> tuple[Inline, ...]:
    if not children:
        return ()

    result: list[Inline] = []
    active_marks: Counter[str] = Counter()
    current_style: Style | None = None
    span_stack: list[tuple[list[str], bool, Style | None]] = []
    seen_unlisted: set[str] = set()

    def _push_text(text: str) -> None:
        if text:
            result.append(
                Text(
                    text=text,
                    marks=_canonical_marks(active_marks),
                    style=current_style,
                )
            )

    for token in children:
        match token.type:
            case "text":
                _push_text(token.content)

            case "softbreak":
                _push_text(" ")

            case "hardbreak":
                result.append(Break())

            case "strong_open":
                active_marks["bold"] += 1

            case "strong_close":
                active_marks["bold"] -= 1
                if not active_marks["bold"]:
                    del active_marks["bold"]

            case "em_open":
                active_marks["italic"] += 1

            case "em_close":
                active_marks["italic"] -= 1
                if not active_marks["italic"]:
                    del active_marks["italic"]

            case "mark_open":
                active_marks["highlight"] += 1

            case "mark_close":
                active_marks["highlight"] -= 1
                if not active_marks["highlight"]:
                    del active_marks["highlight"]

            case "span_open":
                meta = cast("dict[str, object]", token.meta or {})
                classes_raw = meta.get("classes")
                classes: list[str] = cast("list[str]", classes_raw) if classes_raw else []
                font: str | None = cast("str | None", meta.get("font"))
                size: float | None = cast("float | None", meta.get("size"))

                added: list[str] = []
                for c in classes:
                    mark = _CLASS_TO_MARK.get(c)
                    if mark is not None:
                        added.append(mark)
                        active_marks[mark] += 1

                had_style = False
                prev_style: Style | None = None
                if font is not None or size is not None:
                    had_style = True
                    prev_style = current_style
                    if current_style is not None:
                        merged_font = font if font is not None else current_style.font
                        merged_size = size if size is not None else current_style.size
                        current_style = _make_style(merged_font, merged_size)
                    else:
                        current_style = _make_style(font, size)

                span_stack.append((added, had_style, prev_style))

                if font is not None and warnings is not None:
                    lower = font.lower()
                    if lower not in seen_unlisted and lower not in _FONT_NAMES:
                        warnings.append(f"unlisted_font: {font}")
                        seen_unlisted.add(lower)

            case "span_close":
                if span_stack:
                    added, had_style, prev_style = span_stack.pop()
                    for mark in added:
                        active_marks[mark] -= 1
                        if not active_marks[mark]:
                            del active_marks[mark]
                    if had_style:
                        current_style = prev_style

            case "blank":
                meta = cast("dict[str, object]", token.meta or {})
                answers_raw = meta.get("answers")
                answers: tuple[str, ...] = (
                    tuple(cast(list[str], answers_raw)) if answers_raw else ()
                )
                result.append(Blank(answers=answers, style=current_style))

            case _:
                if token.content:
                    _push_text(token.content)

    # Merge consecutive Text nodes with identical marks and style.
    merged: list[Inline] = []
    for item in result:
        if (
            isinstance(item, Text)
            and merged
            and isinstance(merged[-1], Text)
            and merged[-1].marks == item.marks
            and merged[-1].style == item.style
        ):
            last = cast(Text, merged.pop())
            merged.append(
                Text(text=last.text + item.text, marks=item.marks, style=item.style)
            )
        else:
            merged.append(item)

    return tuple(merged)
