"""Inline rules ported from frontend/src/markdown/rules/blank.ts, span.ts, mark.ts."""

import re
from typing import Any

from markdown_it import MarkdownIt
from markdown_it.rules_inline import StateInline

from docuteach.md.fonts import valid_font_name, valid_size

# ---------------------------------------------------------------------------
# blank
# ---------------------------------------------------------------------------


def _is_escaped(src: str, pos: int) -> bool:
    """True if the char at *pos* is preceded by an odd number of backslashes."""
    count = 0
    i = pos - 1
    while i >= 0 and src[i] == "\\":
        count += 1
        i -= 1
    return count % 2 == 1


def _unescape(s: str) -> str:
    """Remove backslash escapes for ``\\``, ``|``, ``}``; keep others."""
    out: list[str] = []
    i = 0
    while i < len(s):
        if s[i] == "\\" and i + 1 < len(s) and s[i + 1] in ("\\", "|", "}"):
            out.append(s[i + 1])
            i += 2
        else:
            out.append(s[i])
            i += 1
    return "".join(out)


def _split_unescaped_pipe(inner: str) -> list[str]:
    """Split *inner* on unescaped ``|`` characters."""
    parts: list[str] = []
    cur = ""
    for i in range(len(inner)):
        if inner[i] == "|" and not _is_escaped(inner, i):
            parts.append(cur)
            cur = ""
        else:
            cur += inner[i]
    parts.append(cur)
    return parts


def _blank_rule(state: StateInline, silent: bool) -> bool:
    if state.pos + 1 >= state.posMax:
        return False
    if state.src[state.pos] != "{" or state.src[state.pos + 1] != "{":
        return False

    start = state.pos
    i = state.pos + 2

    end = -1
    while i < state.posMax:
        if state.src[i] == "\n":
            break
        if (
            state.src[i] == "}"
            and i + 1 < state.posMax
            and state.src[i + 1] == "}"
            and not _is_escaped(state.src, i)
            and not _is_escaped(state.src, i + 1)
        ):
            end = i
            break
        i += 1

    if end == -1:
        return False

    if silent:
        return True

    inner = state.src[start + 2 : end]

    raw_parts = _split_unescaped_pipe(inner)
    answers: list[str] = [
        _unescape(p) for p in (part.strip() for part in raw_parts) if p
    ]

    token = state.push("blank", "", 0)
    token.meta = {"answers": answers}

    state.pos = end + 2
    return True


def blank_plugin(md: MarkdownIt) -> None:
    md.inline.ruler.before("escape", "docuteach_blank", _blank_rule)


# ---------------------------------------------------------------------------
# span
# ---------------------------------------------------------------------------

_VALID_CLASSES: frozenset[str] = frozenset({"u", "b", "i", "hl"})
_SIZE_RE = re.compile(r"^\d+(\.\d)?$")
_STYLE_SPAN_RE = re.compile(
    r'^(\.[^ }]*|[A-Za-z_-]+=[^ }]*|font="[^"]*")( (\.[^ }]*|[A-Za-z_-]+=[^ }]*|font="[^"]*"))*$'
)


def _span_rule_inner(state: StateInline, silent: bool) -> bool:
    if state.src[state.pos] != "[":
        return False

    # Find matching ] (nesting-aware, skip backslash-escaped chars)
    level = 1
    i = state.pos + 1
    while i < state.posMax:
        if state.src[i] == "\\" and i + 1 < state.posMax:
            i += 2
            continue
        if state.src[i] == "[":
            level += 1
        elif state.src[i] == "]":
            level -= 1
            if level == 0:
                break
        i += 1

    if i >= state.posMax or state.src[i] != "]":
        return False

    # Expect { immediately after ]
    j = i + 1
    if j >= state.posMax or state.src[j] != "{":
        return False
    j += 1

    classes: list[str] = []
    font: str | None = None
    size: float | None = None
    first = True

    while j < state.posMax and state.src[j] != "}":
        if not first:
            if state.src[j] != " ":
                return False
            j += 1
        first = False
        if j >= state.posMax:
            return False

        if state.src[j] == ".":
            # .class token
            j += 1
            cls = ""
            while j < state.posMax and state.src[j] != " " and state.src[j] != "}":
                cls += state.src[j]
                j += 1
            if cls == "":
                return False
            classes.append(cls)

        elif state.src[j : j + 6] == 'font="':
            # font="Name" token
            j += 6
            val = ""
            while j < state.posMax and state.src[j] != '"':
                val += state.src[j]
                j += 1
            if j >= state.posMax:
                return False
            j += 1  # skip closing "
            if font is not None:
                return False
            if not valid_font_name(val):
                return False
            font = val

        elif state.src[j : j + 5] == "size=":
            # size=N token
            j += 5
            num = ""
            while j < state.posMax and state.src[j] != " " and state.src[j] != "}":
                num += state.src[j]
                j += 1
            if num == "":
                return False
            if not _SIZE_RE.fullmatch(num):
                return False
            n = float(num)
            if not valid_size(n):
                return False
            if size is not None:
                return False
            size = n

        else:
            return False

    if j >= state.posMax or state.src[j] != "}":
        return False

    # Validate all classes
    for c in classes:
        if c not in _VALID_CLASSES:
            return False
    if not classes and font is None and size is None:
        return False

    if silent:
        return True

    inner_start = state.pos + 1
    inner_end = i  # position of ]

    # Push span_open
    open_token = state.push("span_open", "", 1)
    meta: dict[str, Any] = {"classes": classes}
    if font is not None:
        meta["font"] = font
    if size is not None:
        meta["size"] = size
    open_token.meta = meta

    # Tokenize inner content
    saved_pos = state.pos
    saved_pos_max = state.posMax
    state.pos = inner_start
    state.posMax = inner_end
    state.md.inline.tokenize(state)
    state.pos = saved_pos
    state.posMax = saved_pos_max

    # Push span_close
    state.push("span_close", "", -1)

    state.pos = j + 1  # after }
    return True


def _span_rule(state: StateInline, silent: bool) -> bool:
    if _span_rule_inner(state, silent):
        return True

    # --- rejected-style-span warning (all-or-nothing: no parse change) ---
    if state.src[state.pos] != "[":
        return False

    # Find matching ] (nesting-aware, skip backslash-escaped chars)
    level = 1
    i = state.pos + 1
    while i < state.posMax:
        if state.src[i] == "\\" and i + 1 < state.posMax:
            i += 2
            continue
        if state.src[i] == "[":
            level += 1
        elif state.src[i] == "]":
            level -= 1
            if level == 0:
                break
        i += 1

    if i >= state.posMax or state.src[i] != "]":
        return False

    # Expect { immediately after ]
    j = i + 1
    if j >= state.posMax or state.src[j] != "{":
        return False
    j += 1

    # Find the closing }
    k = j
    while k < state.posMax and state.src[k] != "}":
        k += 1

    if k >= state.posMax:
        return False

    content = state.src[j:k]
    if _STYLE_SPAN_RE.fullmatch(content):
        warnings: list[str] = state.env.setdefault("warnings", [])
        seen: set[tuple[str, int]] = state.env.setdefault("_unsupported_style_seen", set())
        key = (state.src, state.pos)
        if key not in seen:
            seen.add(key)
            warnings.append("unsupported_style")

    return False


def span_plugin(md: MarkdownIt) -> None:
    md.inline.ruler.after("escape", "docuteach_span", _span_rule)


# ---------------------------------------------------------------------------
# mark
# ---------------------------------------------------------------------------


def _is_whitespace(ch: str | None) -> bool:
    return ch is not None and ch in " \t\n\r"


def _mark_rule(state: StateInline, silent: bool) -> bool:
    if state.pos + 1 >= state.posMax:
        return False
    if state.src[state.pos] != "=" or state.src[state.pos + 1] != "=":
        return False

    # Next char after == must not be whitespace or =
    next_ch: str | None = (
        state.src[state.pos + 2] if state.pos + 2 < state.posMax else None
    )
    if next_ch is None or next_ch == "=" or _is_whitespace(next_ch):
        return False

    # Find closing ==
    i = state.pos + 2
    while i + 1 < state.posMax:
        if state.src[i] == "\\":
            i += 2
            continue
        if state.src[i] == "=" and state.src[i + 1] == "=":
            # Char before the closing == must not be whitespace
            prev: str | None = (
                state.src[i - 1] if i > state.pos + 2 else None
            )
            if i > state.pos + 2 and not _is_whitespace(prev):
                if silent:
                    return True

                state.push("mark_open", "", 1)

                # Tokenize inner
                saved_pos = state.pos
                saved_pos_max = state.posMax
                state.pos = state.pos + 2
                state.posMax = i
                state.md.inline.tokenize(state)
                state.pos = saved_pos
                state.posMax = saved_pos_max

                state.push("mark_close", "", -1)

                state.pos = i + 2
                return True
        i += 1

    return False


def mark_plugin(md: MarkdownIt) -> None:
    md.inline.ruler.after("escape", "docuteach_mark", _mark_rule)
