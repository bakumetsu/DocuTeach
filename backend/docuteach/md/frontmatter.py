"""Front-matter splitting ported from frontend/src/markdown/frontmatter.ts."""

from dataclasses import dataclass
from typing import Any, cast

import yaml

from docuteach.md.model import Meta


@dataclass
class FrontMatter:
    meta: Meta
    body: str
    warning: str | None = None


EMPTY_META: Meta = Meta()


def split_front_matter(text: str) -> FrontMatter:
    """Split *text* into YAML front matter and body, mirroring the TS rules."""
    if not text.startswith("---\n"):
        return FrontMatter(meta=EMPTY_META, body=text)

    lines = text.split("\n")
    close_idx = -1
    for i in range(1, len(lines)):
        if lines[i] == "---":
            close_idx = i
            break

    if close_idx == -1:
        return FrontMatter(meta=EMPTY_META, body=text)

    raw = "\n".join(lines[1 : close_idx])

    body_lines = lines[close_idx + 1 :]
    if body_lines and body_lines[0] == "":
        body_lines = body_lines[1:]
    body = "\n".join(body_lines)

    data: dict[str, Any] | None
    broken = False
    warning: str | None = None

    if raw == "":
        data = {}
    else:
        try:
            parsed: object = yaml.safe_load(raw)
            if isinstance(parsed, dict):
                data = cast(dict[str, Any], parsed)
            else:
                broken = True
                data = None
                warning = "Front matter is not valid YAML; kept as written"
        except yaml.YAMLError:
            broken = True
            data = None
            warning = "Front matter is not valid YAML; kept as written"

    return FrontMatter(
        meta=Meta(raw=raw, data=data, broken=broken),
        body=body,
        warning=warning,
    )
