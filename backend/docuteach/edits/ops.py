from __future__ import annotations

import re
from dataclasses import dataclass

MAX_REPLY_CHARS: int = 600
MAX_OPS: int = 40
MAX_RANGE: int = 1000

_ID = r"b\d+"
_REPLACE_RE = re.compile(rf"^@@\s+replace\s+({_ID})(?:\s*-\s*({_ID}))?\s+@@$")
_INSERT_RE = re.compile(rf"^@@\s+insert\s+(before|after)\s+({_ID})\s+@@$")
_DELETE_RE = re.compile(rf"^@@\s+delete\s+({_ID})(?:\s*-\s*({_ID}))?\s+@@$")
_MOVE_RE = re.compile(rf"^@@\s+move\s+({_ID})(?:\s*-\s*({_ID}))?\s+(before|after)\s+({_ID})\s+@@$")
_END_RE = re.compile(r"^@@\s+end\s+@@$")


@dataclass(frozen=True)
class Op:
    kind: str
    targets: tuple[str, ...]
    anchor: str | None
    side: str | None
    markdown: str | None
    header: str


@dataclass(frozen=True)
class Reply:
    text: str


@dataclass(frozen=True)
class Skip:
    code: str
    header: str


type Item = Reply | Op | Skip

# Internal: (kind, targets, anchor, side, has_body, is_bad); None means not a header.
type _HInfo = tuple[str, tuple[str, ...], str | None, str | None, bool, bool]


def _expand_range(start: int, end: int) -> tuple[str, ...] | None:
    if end < start:
        return None
    if end - start + 1 > MAX_RANGE:
        return None
    return tuple(f"b{i}" for i in range(start, end + 1))


def _num(s: str) -> int:
    return int(s[1:])


class EditParser:
    def __init__(self) -> None:
        self._buf: str = ""
        self._reply_chars: int = 0
        self._reply_done: bool = False
        self._ops_opened: int = 0
        self._stopped: bool = False
        self._finished: bool = False
        self._open_kind: str | None = None
        self._open_targets: tuple[str, ...] = ()
        self._open_anchor: str | None = None
        self._open_side: str | None = None
        self._open_header: str = ""
        self._open_body: list[str] = []
        self._open_bad: bool = False
        self._open_too_many: bool = False
        self._open_has_body: bool = False

    @property
    def ended(self) -> bool:
        """True once the `@@ end @@` marker has been seen."""
        return self._stopped

    # -- public API ----------------------------------------------------------

    def feed(self, chunk: str) -> list[Item]:
        if self._stopped or self._finished:
            return []
        items: list[Item] = []
        self._buf += chunk
        while "\n" in self._buf:
            line, self._buf = self._buf.split("\n", 1)
            items.extend(self._process_line(line, True))
            if self._stopped:
                break
        return items

    def finish(self, complete: bool) -> list[Item]:
        if self._stopped or self._finished:
            return []
        self._finished = True
        items: list[Item] = []
        if complete:
            if self._buf:
                items.extend(self._process_line(self._buf, False))
            self._buf = ""
            if self._open_kind is not None:
                items.extend(self._close_op())
        else:
            self._buf = ""
            if self._open_kind is not None:
                items.append(Skip("cut_off", self._open_header))
                self._reset_open()
        return items

    # -- internals -----------------------------------------------------------

    def _process_line(self, line: str, has_nl: bool) -> list[Item]:
        stripped = line.strip()

        if _END_RE.match(stripped):
            items: list[Item] = []
            if self._open_kind is not None:
                items.extend(self._close_op())
            self._stopped = True
            return items

        info = _parse_header(stripped)
        if info is not None:
            items = []
            if self._open_kind is not None:
                items.extend(self._close_op())
            self._open_new_op(info, stripped)
            return items

        # Plain text line
        if self._open_kind is not None:
            if self._open_has_body:
                self._open_body.append(line)
            return []
        return self._emit_reply(line, has_nl)

    def _open_new_op(self, info: _HInfo, header: str) -> None:
        kind, targets, anchor, side, has_body, is_bad = info
        self._ops_opened += 1
        self._open_kind = kind if not is_bad else ""
        self._open_targets = targets
        self._open_anchor = anchor
        self._open_side = side
        self._open_header = header
        self._open_body = []
        self._open_has_body = True if is_bad else has_body
        self._open_bad = is_bad
        self._open_too_many = self._ops_opened > MAX_OPS

    def _close_op(self) -> list[Item]:
        kind = self._open_kind
        header = self._open_header
        targets = self._open_targets
        anchor = self._open_anchor
        side = self._open_side
        body = self._open_body
        too_many = self._open_too_many
        bad = self._open_bad
        self._reset_open()

        if too_many:
            return [Skip("too_many_ops", header)]
        if bad:
            return [Skip("bad_range", header)]
        assert kind is not None

        markdown: str | None = None
        if kind in ("replace", "insert") and body:
            stripped: str = "\n".join(body).strip("\n")
            # Remove leading/trailing blank lines
            while stripped.startswith("\n"):
                stripped = stripped[1:]
            while stripped.endswith("\n"):
                stripped = stripped[:-1]
            markdown = stripped if stripped else None

        return [Op(kind, targets, anchor, side, markdown, header)]

    def _reset_open(self) -> None:
        self._open_kind = None
        self._open_targets = ()
        self._open_anchor = None
        self._open_side = None
        self._open_header = ""
        self._open_body = []
        self._open_bad = False
        self._open_too_many = False
        self._open_has_body = False

    def _emit_reply(self, line: str, has_nl: bool) -> list[Item]:
        if self._reply_done:
            return []
        chunk = line + "\n" if has_nl else line
        if not chunk:
            return []
        remaining = MAX_REPLY_CHARS - self._reply_chars
        if len(chunk) <= remaining:
            self._reply_chars += len(chunk)
            if self._reply_chars >= MAX_REPLY_CHARS:
                self._reply_done = True
            return [Reply(chunk)]
        if remaining > 0:
            self._reply_chars = MAX_REPLY_CHARS
            self._reply_done = True
            return [Reply(chunk[:remaining])]
        self._reply_done = True
        return []


def _parse_header(line: str) -> _HInfo | None:
    m = _REPLACE_RE.match(line)
    if m:
        s, e = m.group(1), m.group(2)
        if e is None:
            return ("replace", (s,), None, None, True, False)
        exp = _expand_range(_num(s), _num(e))
        if exp is None:
            return ("", (), None, None, True, True)
        return ("replace", exp, None, None, True, False)

    m = _INSERT_RE.match(line)
    if m:
        return ("insert", (), m.group(2), m.group(1), True, False)

    m = _DELETE_RE.match(line)
    if m:
        s, e = m.group(1), m.group(2)
        if e is None:
            return ("delete", (s,), None, None, False, False)
        exp = _expand_range(_num(s), _num(e))
        if exp is None:
            return ("", (), None, None, True, True)
        return ("delete", exp, None, None, False, False)

    m = _MOVE_RE.match(line)
    if m:
        s, e = m.group(1), m.group(2)
        if e is None:
            return ("move", (s,), m.group(4), m.group(3), False, False)
        exp = _expand_range(_num(s), _num(e))
        if exp is None:
            return ("", (), None, None, True, True)
        return ("move", exp, m.group(4), m.group(3), False, False)

    return None


def parse_ops(text: str, complete: bool = True) -> tuple[str, list[Op], list[Skip]]:
    parser = EditParser()
    items = parser.feed(text)
    items.extend(parser.finish(complete))
    reply_parts: list[str] = []
    ops: list[Op] = []
    skips: list[Skip] = []
    for item in items:
        if isinstance(item, Reply):
            reply_parts.append(item.text)
        elif isinstance(item, Op):
            ops.append(item)
        else:
            skips.append(item)
    return "".join(reply_parts).strip(), ops, skips
