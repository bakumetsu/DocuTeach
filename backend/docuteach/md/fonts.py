"""Pure font helpers ported from frontend/src/editor/fontStyle.ts."""

import json
import math
from pathlib import Path
from typing import Any

_FONTS_PATH = Path(__file__).with_name("fonts.json")

with _FONTS_PATH.open(encoding="utf-8") as _f:
    FONTS: list[dict[str, Any]] = json.load(_f)


def canonical_font(name: str) -> str:
    """Return the canonical display name for *name*, or *name* if not found."""
    lower = name.lower()
    for entry in FONTS:
        if entry["name"].lower() == lower:
            return entry["name"]
    return name


def valid_font_name(name: str) -> bool:
    """True if *name* is 1-40 chars each of letter, digit, space, or hyphen."""
    if not 1 <= len(name) <= 40:
        return False
    for ch in name:
        if not (ch.isalpha() or ch.isnumeric() or ch in " -"):
            return False
    return True


def valid_size(n: float) -> bool:
    """True if *n* is a finite half-integer in [6, 72]."""
    if not math.isfinite(n):
        return False
    if n < 6.0 or n > 72.0:
        return False
    return n % 0.5 == 0
