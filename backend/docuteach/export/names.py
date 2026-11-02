from __future__ import annotations

import re
from urllib.parse import quote

_RESERVED: frozenset[str] = frozenset(
    {"CON", "PRN", "AUX", "NUL"}
    | {f"COM{i}" for i in range(1, 10)}
    | {f"LPT{i}" for i in range(1, 10)}
)

_FORBIDDEN = re.compile(r'[\\/:*?"<>|]')
_CONTROL = re.compile(r"[\x00-\x1f]")
_WS = re.compile(r"\s+")


def _clean(text: str) -> str:
    text = _FORBIDDEN.sub("", text)
    text = _CONTROL.sub("", text)
    text = _WS.sub(" ", text)
    return text.strip(" .")


def sanitize_filename(title: str, part_label: str, kind: str) -> str:
    title = _clean(title)
    part_label = _clean(part_label)

    if not title:
        title = "Lesson"
    if not part_label:
        part_label = "Part"

    if title.rsplit(".", 1)[0].upper() in _RESERVED:
        title = "_" + title

    kind_label = "student" if kind == "student" else "teacher"
    ext = "pdf" if kind == "student" else "docx"

    stem = f"{title} - {part_label} - {kind_label}"[:80]
    stem = stem.rstrip(" .")

    return f"{stem}.{ext}"


def content_disposition(filename: str) -> str:
    ascii_name = re.sub(r"[^\x00-\x7f]|[\"\\]", "_", filename)
    percent = quote(filename, safe="")
    return f'attachment; filename="{ascii_name}"; filename*=UTF-8\'\'{percent}'
