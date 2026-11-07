"""DocuTeach markdown-it-py block rules: div, comment, raw, table."""

from __future__ import annotations

import re

from markdown_it import MarkdownIt
from markdown_it.rules_block import StateBlock
from markdown_it.token import Token

# ---------------------------------------------------------------------------
# table
# ---------------------------------------------------------------------------

_ALIGN_RE = re.compile(r"^:?-+:?$")


def _split_row(line: str) -> list[str]:
    """Split a table row into cells.

    - Trims the line.
    - Drops one leading ``|`` and one trailing unescaped ``|``.
    - Splits on ``|`` except:
      (a) ``|`` inside a blank ``{{ ... }}`` never splits.
      (b) ``|`` preceded by an odd number of backslashes outside blanks is
          escaped (becomes a literal ``|``, one backslash removed).
    - Each cell is trimmed.
    """
    s = line.strip()

    # Drop one leading |
    if s.startswith("|"):
        s = s[1:]

    # Drop one trailing unescaped |
    if s.endswith("|"):
        i = len(s) - 2
        bs = 0
        while i >= 0 and s[i] == "\\":
            bs += 1
            i -= 1
        if bs % 2 == 0:
            s = s[:-1]

    cells: list[str] = []
    current = ""
    in_blank = False
    i = 0

    while i < len(s):
        if in_blank:
            # Check for closing }}
            if s[i] == "}" and i + 1 < len(s) and s[i + 1] == "}":
                j = i - 1
                bs = 0
                while j >= 0 and s[j] == "\\":
                    bs += 1
                    j -= 1
                if bs % 2 == 0:
                    current += "}}"
                    i += 2
                    in_blank = False
                    continue
            # Inside blank: pass through unchanged
            current += s[i]
            i += 1
        else:
            # Check for opening {{
            if s[i] == "{" and i + 1 < len(s) and s[i + 1] == "{":
                in_blank = True
                current += s[i]
                i += 1
                continue

            # Check for |
            if s[i] == "|":
                j = i - 1
                bs = 0
                while j >= 0 and s[j] == "\\":
                    bs += 1
                    j -= 1
                if bs % 2 == 1:
                    # Escaped pipe: remove one backslash, add literal |
                    current = current[:-1] + "|"
                else:
                    # Real separator
                    cells.append(current.strip())
                    current = ""
                i += 1
                continue

            current += s[i]
            i += 1

    cells.append(current.strip())
    return cells


def _has_unescaped_pipe(line: str) -> bool:
    """Return True if the line contains at least one unescaped ``|`` outside blanks."""
    in_blank = False
    i = 0
    while i < len(line):
        if in_blank:
            if line[i] == "}" and i + 1 < len(line) and line[i + 1] == "}":
                j = i - 1
                bs = 0
                while j >= 0 and line[j] == "\\":
                    bs += 1
                    j -= 1
                if bs % 2 == 0:
                    in_blank = False
                    i += 1
        else:
            if line[i] == "{" and i + 1 < len(line) and line[i + 1] == "{":
                in_blank = True
                i += 1
            elif line[i] == "|":
                j = i - 1
                bs = 0
                while j >= 0 and line[j] == "\\":
                    bs += 1
                    j -= 1
                if bs % 2 == 0:
                    return True
        i += 1
    return False


def _table_rule(
    state: StateBlock, start_line: int, end_line: int, silent: bool
) -> bool:
    """Block rule that matches GFM-style pipe tables."""
    # --- Header line ---
    header_full = state.src[state.bMarks[start_line] : state.eMarks[start_line]]
    indent = len(header_full) - len(header_full.lstrip())
    if indent >= 4:
        return False

    header_text = state.src[
        state.bMarks[start_line] + state.tShift[start_line] : state.eMarks[start_line]
    ]
    if not _has_unescaped_pipe(header_text):
        return False

    # --- Alignment row (next line) ---
    if start_line + 1 >= end_line:
        return False

    align_text = state.src[
        state.bMarks[start_line + 1]
        + state.tShift[start_line + 1] : state.eMarks[start_line + 1]
    ]
    align_cells = _split_row(align_text)
    header_cells = _split_row(header_text)

    if len(align_cells) != len(header_cells):
        return False
    for cell in align_cells:
        if not _ALIGN_RE.fullmatch(cell):
            return False

    if silent:
        return True

    # --- Body rows ---
    body_start = start_line + 2
    body_end = body_start

    while body_end < end_line:
        if state.isEmpty(body_end):
            break
        body_text = state.src[
            state.bMarks[body_end] + state.tShift[body_end] : state.eMarks[body_end]
        ]
        if not _has_unescaped_pipe(body_text):
            break
        body_end += 1

    # Collect all rows and find widest
    body_rows: list[list[str]] = []
    for line_idx in range(body_start, body_end):
        row_text = state.src[
            state.bMarks[line_idx] + state.tShift[line_idx] : state.eMarks[line_idx]
        ]
        body_rows.append(_split_row(row_text))

    max_cols = len(header_cells)
    for row in body_rows:
        if len(row) > max_cols:
            max_cols = len(row)

    # Pad all rows to max_cols
    while len(header_cells) < max_cols:
        header_cells.append("")
    for row in body_rows:
        while len(row) < max_cols:
            row.append("")

    # Parse column alignments
    aligns: list[str | None] = []
    for cell in align_cells:
        if cell.startswith(":") and cell.endswith(":"):
            aligns.append("center")
        elif cell.startswith(":"):
            aligns.append("left")
        elif cell.endswith(":"):
            aligns.append("right")
        else:
            aligns.append(None)
    while len(aligns) < max_cols:
        aligns.append(None)

    # --- Emit tokens ---
    table_open: Token = state.push("table_open", "table", 1)
    table_open.map = [start_line, body_end]
    table_open.meta = {"aligns": aligns}

    state.push("thead_open", "thead", 1)
    state.push("tr_open", "tr", 1)
    for cell in header_cells:
        state.push("th_open", "th", 1)
        inline: Token = state.push("inline", "", 0)
        inline.content = cell
        inline.children = []
        inline.map = [start_line, start_line + 1]
        state.push("th_close", "th", -1)
    state.push("tr_close", "tr", -1)
    state.push("thead_close", "thead", -1)

    if body_rows:
        state.push("tbody_open", "tbody", 1)
        for r in range(len(body_rows)):
            line_idx = body_start + r
            state.push("tr_open", "tr", 1)
            for cell in body_rows[r]:
                state.push("td_open", "td", 1)
                inline: Token = state.push("inline", "", 0)
                inline.content = cell
                inline.children = []
                inline.map = [line_idx, line_idx + 1]
                state.push("td_close", "td", -1)
            state.push("tr_close", "tr", -1)
        state.push("tbody_close", "tbody", -1)

    state.push("table_close", "table", -1)

    state.line = body_end
    return True


def table_plugin(md: MarkdownIt) -> None:
    """Register the DocuTeach table block rule (before 'list')."""
    md.block.ruler.before("list", "docuteach_table", _table_rule)
