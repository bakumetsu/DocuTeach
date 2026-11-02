"""Block-level rules for DocuTeach markdown parsing."""

from __future__ import annotations

import re
from typing import cast

from markdown_it import MarkdownIt
from markdown_it.rules_block import StateBlock

_ALIGN_RE = re.compile(r"^::: \{\.(center|right|justify)\}\s*$")
_BARE_RE = re.compile(r"^:::\s*$")
_TEACHER_RE = re.compile(r'^::: teacher(?:\s+\{tag="((?:[^"\\]|\\.)*)"\})?\s*$')
_SPLIT_RE = re.compile(r"^<!--\s*split:\s*(.*?)\s*-->")
_FENCE_RE = re.compile(r"^(`{3,}|~{3,})(.*)$")
_HR_RE = re.compile(r"^(-(\s*-){2,}|\*(\s*\*){2,}|_(\s*_){2,})$")


def _unescape_tag(s: str) -> str:
    """Unescape backslash-escaped characters in a tag value."""
    result: list[str] = []
    i = 0
    while i < len(s):
        if s[i] == "\\" and i + 1 < len(s):
            result.append(s[i + 1])
            i += 2
        else:
            result.append(s[i])
            i += 1
    return "".join(result)


def _line_text(state: StateBlock, line: int) -> str:
    return state.src[state.bMarks[line] + state.tShift[line] : state.eMarks[line]]


def _raw_line_text(state: StateBlock, line: int) -> str:
    return state.src[state.bMarks[line] : state.eMarks[line]]


def div_plugin(md: MarkdownIt) -> None:
    """Register ::: div blocks (align, teacher, raw) before the list rule."""

    def _is_bare_close(text: str) -> bool:
        return _BARE_RE.match(text) is not None

    def _align_from(text: str) -> str | None:
        m = _ALIGN_RE.match(text)
        return m.group(1) if m else None

    def _teacher_tag_from(text: str) -> str | None:
        m = _TEACHER_RE.match(text)
        if m is None:
            return None
        return _unescape_tag(m.group(1)) if m.group(1) is not None else ""

    def _find_close_line(
        state: StateBlock, start_line: int, end_line: int
    ) -> int | None:
        depth = 1
        for line in range(start_line + 1, end_line):
            text = _line_text(state, line)
            if _is_bare_close(text):
                depth -= 1
                if depth == 0:
                    return line
            elif _align_from(text) is not None:
                depth += 1
        return None

    def _raw_block_content(
        state: StateBlock, start_line: int, end_line: int
    ) -> str:
        return "\n".join(_raw_line_text(state, line_no) for line_no in range(start_line, end_line))

    def _add_warning(state: StateBlock, message: str) -> None:
        existing = state.env.get("warnings")
        if isinstance(existing, list):
            cast("list[str]", existing).append(message)
        else:
            state.env["warnings"] = [message]

    def _tokenize_nested_blocks(
        state: StateBlock, start_line: int, end_line: int, parent_type: str
    ) -> None:
        old_parent_type = state.parentType
        old_line_max = state.lineMax
        state.parentType = parent_type
        state.lineMax = end_line
        state.line = start_line
        state.md.block.tokenize(state, start_line, end_line)
        state.line = end_line
        state.lineMax = old_line_max
        state.parentType = old_parent_type

    def rule(
        state: StateBlock, start_line: int, end_line: int, silent: bool
    ) -> bool:
        if state.tShift[start_line] >= 4:
            return False

        text = _line_text(state, start_line)
        if not text.startswith(":::"):
            return False

        parent_type = state.parentType
        is_top_level = parent_type == "" or parent_type == "root"
        is_container = parent_type in ("blockquote", "list")
        allowed_for_teacher_and_unknown = is_top_level or is_container
        allowed_for_align = (
            allowed_for_teacher_and_unknown
            or parent_type in ("teacher", "align")
        )

        if _is_bare_close(text):
            return False

        align = _align_from(text)
        if align is not None:
            if silent:
                return True
            if not allowed_for_align:
                return False

            close_line = _find_close_line(state, start_line, end_line)
            block_end = end_line if close_line is None else close_line + 1

            if close_line is None:
                _add_warning(state, "Unclosed alignment block")

            open_tok = state.push("align_open", "div", 1)
            open_tok.map = [start_line, block_end]
            open_tok.meta = {"align": align}

            inner_end = close_line if close_line is not None else end_line
            _tokenize_nested_blocks(state, start_line + 1, inner_end, "align")

            close_tok = state.push("align_close", "div", -1)
            if close_line is None:
                close_tok.map = [end_line, end_line]
            else:
                close_tok.map = [close_line, close_line + 1]

            state.line = end_line if close_line is None else close_line + 1
            return True

        if not allowed_for_teacher_and_unknown:
            return False

        tag = _teacher_tag_from(text)
        if tag is not None:
            if silent:
                return True

            close_line = _find_close_line(state, start_line, end_line)
            block_end = end_line if close_line is None else close_line + 1

            if close_line is None:
                _add_warning(
                    state, "Unclosed teacher note runs to the end of the file"
                )

            open_tok = state.push("teacher_open", "div", 1)
            open_tok.map = [start_line, block_end]
            open_tok.meta = {"tag": tag}

            inner_end = close_line if close_line is not None else end_line
            _tokenize_nested_blocks(state, start_line + 1, inner_end, "teacher")

            close_tok = state.push("teacher_close", "div", -1)
            if close_line is None:
                close_tok.map = [end_line, end_line]
            else:
                close_tok.map = [close_line, close_line + 1]

            state.line = end_line if close_line is None else close_line + 1
            return True

        if silent:
            return True

        close_line = _find_close_line(state, start_line, end_line)
        block_end = end_line if close_line is None else close_line + 1

        if close_line is None:
            _add_warning(state, "Unclosed block")

        raw_tok = state.push("raw_block", "div", 0)
        raw_tok.map = [start_line, block_end]
        raw_tok.content = _raw_block_content(state, start_line, block_end)

        state.line = block_end
        return True

    md.block.ruler.before("list", "docuteach_div", rule, {"alt": ["paragraph"]})


def comment_plugin(md: MarkdownIt) -> None:
    """Register HTML comment / split_point rule before the list rule."""

    def rule(
        state: StateBlock, start_line: int, end_line: int, silent: bool
    ) -> bool:
        if state.sCount[start_line] >= 4:
            return False

        line = _line_text(state, start_line)
        if not line.startswith("<!--"):
            return False

        close_line = -1
        for i in range(start_line, end_line):
            text = _line_text(state, i)
            if "-->" in text:
                close_line = i
                break

        if close_line == -1:
            close_line = end_line - 1

        if silent:
            return True

        if close_line == start_line:
            trimmed = line.strip()
            m = _SPLIT_RE.match(trimmed)
            if m:
                t = state.push("split_point", "", 0)
                t.map = [start_line, close_line + 1]
                label = m.group(1) if m.group(1) != "" else "Homework starts here"
                t.meta = {"label": label}
                state.line = close_line + 1
                return True

        parts: list[str] = []
        for i in range(start_line, close_line + 1):
            parts.append(_line_text(state, i))

        t = state.push("raw_block", "", 0)
        t.map = [start_line, close_line + 1]
        t.content = "\n".join(parts)
        state.line = close_line + 1
        return True

    md.block.ruler.before("list", "docuteach_comment", rule, {"alt": ["paragraph"]})


def raw_plugin(md: MarkdownIt) -> None:
    """Register raw block rule (fenced code, blockquote, hr, html) before list."""

    def rule(
        state: StateBlock, start_line: int, end_line: int, silent: bool
    ) -> bool:
        b_marks = state.bMarks
        e_marks = state.eMarks
        src = state.src

        line = start_line
        raw_line = src[b_marks[line] : e_marks[line]]

        first_non_space = 0
        while first_non_space < len(raw_line) and raw_line[first_non_space] in (
            " ",
            "\t",
        ):
            first_non_space += 1
        if first_non_space >= 4:
            return False

        text = raw_line[first_non_space :]

        # 1. Fenced code
        fence_match = _FENCE_RE.match(text)
        if fence_match:
            fence_char = fence_match.group(1)[0]
            fence_len = len(fence_match.group(1))

            close_line = -1
            for i in range(line + 1, end_line):
                i_line = src[b_marks[i] : e_marks[i]]
                trimmed = i_line.strip()
                if len(trimmed) >= fence_len and all(
                    c == fence_char for c in trimmed
                ):
                    close_line = i
                    break

            last_line = end_line - 1 if close_line == -1 else close_line

            if not silent:
                lines: list[str] = [
                    src[b_marks[i] : e_marks[i]] for i in range(line, last_line + 1)
                ]
                t = state.push("raw_block", "", 0)
                t.content = "\n".join(lines)
                t.map = [line, last_line + 1]
                state.line = last_line + 1
            return True

        # 2. Blockquote
        if len(text) > 0 and text[0] == ">":
            last_line = line
            for i in range(line + 1, end_line):
                i_line = src[b_marks[i] : e_marks[i]]
                j = 0
                while j < 3 and j < len(i_line) and i_line[j] == " ":
                    j += 1
                if j < len(i_line) and i_line[j] == ">":
                    last_line = i
                else:
                    break

            if not silent:
                lines = [
                    src[b_marks[i] : e_marks[i]] for i in range(line, last_line + 1)
                ]
                t = state.push("raw_block", "", 0)
                t.content = "\n".join(lines)
                t.map = [line, last_line + 1]
                state.line = last_line + 1
            return True

        # 3. Horizontal rule
        hr_text = text.strip()
        if len(hr_text) >= 3 and _HR_RE.match(hr_text):
            if not silent:
                t = state.push("raw_block", "", 0)
                t.content = raw_line
                t.map = [line, line + 1]
                state.line = line + 1
            return True

        # 4. HTML block
        if len(text) > 1 and text[0] == "<":
            next_char = text[1]
            is_ascii_letter = ("a" <= next_char <= "z") or ("A" <= next_char <= "Z")
            if is_ascii_letter:
                last_line = line
                for i in range(line + 1, end_line):
                    i_line = src[b_marks[i] : e_marks[i]]
                    if i_line.strip() == "":
                        break
                    last_line = i

                if not silent:
                    lines = [
                        src[b_marks[i] : e_marks[i]]
                        for i in range(line, last_line + 1)
                    ]
                    t = state.push("raw_block", "", 0)
                    t.content = "\n".join(lines)
                    t.map = [line, last_line + 1]
                    state.line = last_line + 1
                return True

        return False

    md.block.ruler.before("list", "docuteach_raw", rule, {"alt": ["paragraph"]})


def table_plugin(md: MarkdownIt) -> None:
    """Table rule placeholder (not ported)."""
