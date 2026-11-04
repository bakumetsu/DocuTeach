"""Server-side checks for a single edit op."""

from __future__ import annotations

import difflib
import re
from collections import Counter
from dataclasses import dataclass

from docuteach.edits import EditPayload
from docuteach.edits.ops import Op, Skip
from docuteach.md.model import (
    Blank,
    Block,
    BulletList,
    Heading,
    Inline,
    Mcq,
    OrderedList,
    Paragraph,
    RawBlock,
    SplitPoint,
    Table,
    TeacherNote,
    Text,
)
from docuteach.md.parser import parse_markdown


@dataclass(frozen=True)
class Checked:
    op: Op
    flags: tuple[str, ...]


# ---------------------------------------------------------------------------
# Module-level helpers
# ---------------------------------------------------------------------------


def _inline_text(inline: Inline) -> str:
    if isinstance(inline, Text):
        return inline.text
    if isinstance(inline, Blank):
        return "|".join(inline.answers)
    return ""


def _content_text(content: tuple[Inline, ...]) -> str:
    return "".join(_inline_text(i) for i in content)


def _block_text(block: Block) -> str:
    if isinstance(block, (Heading, Paragraph)):
        return _content_text(block.content)
    if isinstance(block, (BulletList, OrderedList)):
        parts: list[str] = []
        for item in block.items:
            parts.append(_content_text(item.content))
            for nested in item.nested:
                parts.append(_block_text(nested))
        return "".join(parts)
    if isinstance(block, Table):
        return "".join(_content_text(cell.content) for row in block.rows for cell in row)
    if isinstance(block, Mcq):
        return _content_text(block.question) + "".join(
            _content_text(o.content) for o in block.options
        )
    if isinstance(block, TeacherNote):
        return "".join(_block_text(b) for b in block.blocks)
    if isinstance(block, SplitPoint):
        return block.label
    return block.text


def _walk_blocks(blocks: tuple[Block, ...]) -> list[Block]:
    """All blocks recursively, including inside TeacherNote and nested lists."""
    result: list[Block] = []
    for b in blocks:
        result.append(b)
        if isinstance(b, TeacherNote):
            result.extend(_walk_blocks(b.blocks))
        elif isinstance(b, (BulletList, OrderedList)):
            for item in b.items:
                for nested in item.nested:
                    result.extend(_walk_blocks((nested,)))
    return result


def _tick_similar(a: str, b: str) -> bool:
    return difflib.SequenceMatcher(None, a, b).ratio() >= 0.8


def _collect_mcq_options(blocks: list[Block]) -> list[tuple[str, bool]]:
    """All MCQ options as (text, ticked) in document order."""
    result: list[tuple[str, bool]] = []
    for b in _walk_blocks(tuple(blocks)):
        if isinstance(b, Mcq):
            for o in b.options:
                result.append((_content_text(o.content).strip(), o.correct))
    return result


def _collect_blanks(blocks: list[Block]) -> list[tuple[str, ...]]:
    """All Blank answer tuples (stripped) in document order."""
    result: list[tuple[str, ...]] = []
    for b in blocks:
        _collect_blanks_one(b, result)
    return result


def _collect_blanks_one(block: Block, out: list[tuple[str, ...]]) -> None:
    if isinstance(block, (Heading, Paragraph)):
        _blanks_from_inlines(block.content, out)
    elif isinstance(block, (BulletList, OrderedList)):
        for item in block.items:
            _blanks_from_inlines(item.content, out)
            for nested in item.nested:
                _collect_blanks_one(nested, out)
    elif isinstance(block, Table):
        for row in block.rows:
            for cell in row:
                _blanks_from_inlines(cell.content, out)
    elif isinstance(block, Mcq):
        _blanks_from_inlines(block.question, out)
        for o in block.options:
            _blanks_from_inlines(o.content, out)
    elif isinstance(block, TeacherNote):
        for b in block.blocks:
            _collect_blanks_one(b, out)
    # SplitPoint, RawBlock: no inline content


def _blanks_from_inlines(content: tuple[Inline, ...], out: list[tuple[str, ...]]) -> None:
    for inline in content:
        if isinstance(inline, Blank):
            out.append(tuple(a.strip() for a in inline.answers))


def _has_text(content: tuple[Inline, ...]) -> bool:
    return any(isinstance(i, Text) and i.text.strip() for i in content)


def _inline_contents(block: Block) -> list[tuple[Inline, ...]]:
    """Collect all inline-content tuples from a single block."""
    contents: list[tuple[Inline, ...]] = []
    if isinstance(block, (Heading, Paragraph)):
        contents.append(block.content)
    elif isinstance(block, (BulletList, OrderedList)):
        for item in block.items:
            contents.append(item.content)
    elif isinstance(block, Table):
        for row in block.rows:
            for cell in row:
                contents.append(cell.content)
    elif isinstance(block, Mcq):
        contents.append(block.question)
        for o in block.options:
            contents.append(o.content)
    # TeacherNote, SplitPoint, RawBlock: no inline content
    return contents


_SPLIT_INLINE_RE = re.compile(r"^\s*<!--\s*split:")
_NOTE_START_RE = re.compile(r"^:::\s+teacher\b")


# ---------------------------------------------------------------------------
# Checker
# ---------------------------------------------------------------------------


class OpChecker:
    def __init__(self, payload: EditPayload) -> None:
        self._payload = payload
        self._block_role: dict[str, str] = {b.id: b.role for b in payload.blocks}
        self._block_md: dict[str, str] = {b.id: b.md for b in payload.blocks}
        self._targeted_ids: set[str] = set()
        self.no_change: int = 0

    # -- public API ----------------------------------------------------------

    def check(self, op: Op) -> Checked | Skip | None:
        flags: list[str] = []

        # 1. unknown_block / out_of_scope / move-anchor-is-own-target
        ids_to_check: list[str] = list(op.targets)
        if op.anchor is not None:
            ids_to_check.append(op.anchor)
        for bid in ids_to_check:
            if bid not in self._block_role:
                return Skip("unknown_block", op.header)
        for bid in op.targets:
            if self._block_role[bid] == "context":
                return Skip("out_of_scope", op.header)
        if op.kind in ("insert", "move") and op.anchor is not None:
            if self._block_role[op.anchor] == "context":
                return Skip("out_of_scope", op.header)
        if op.kind == "move" and op.anchor is not None and op.anchor in op.targets:
            return Skip("overlap", op.header)

        # 2. overlap with earlier accepted op
        if op.kind in ("replace", "delete", "move"):
            for bid in op.targets:
                if bid in self._targeted_ids:
                    return Skip("overlap", op.header)

        # 3. Body checks (replace, insert only)
        new_blocks: list[Block] = []
        if op.kind in ("replace", "insert"):
            if op.markdown is None or op.markdown.strip() == "":
                return Skip("empty_body", op.header)
            md = op.markdown
            if len(md) > 8000:
                return Skip("too_long", op.header)
            pr = parse_markdown(md)
            if len(pr.doc.blocks) > 30:
                return Skip("too_long", op.header)
            if pr.doc.meta.raw.strip():
                return Skip("front_matter", op.header)
            if any(isinstance(b, RawBlock) for b in pr.doc.blocks):
                return Skip("raw_block", op.header)
            if pr.warnings:
                return Skip("parse_warning", op.header)
            new_blocks = list(pr.doc.blocks)

        # 4. no_change (replace only)
        if op.kind == "replace":
            assert op.markdown is not None  # guaranteed by check 3
            old_md = "\n\n".join(self._block_md[bid] for bid in op.targets).strip()
            if op.markdown.strip() == old_md:
                self.no_change += 1
                return None

        # 5. Structure of parsed new blocks
        if new_blocks:
            code = self._check_structure(new_blocks, op.markdown)
            if code is not None:
                return Skip(code, op.header)

        # 6. Page-split checks
        code = self._check_split(op, new_blocks)
        if code is not None:
            return Skip(code, op.header)

        # 7. Protection
        code, prot_flags = self._protection(op, new_blocks)
        flags.extend(prot_flags)
        if code is not None:
            if self._payload.allowProtected:
                flags.append("changes_protected")
            else:
                return Skip(code, op.header)

        # Record targets for accepted replace/delete/move ops
        if op.kind in ("replace", "delete", "move"):
            self._targeted_ids.update(op.targets)

        return Checked(op, tuple(flags))

    def targeted_edit_blocks(self) -> int:
        return len(self._targeted_ids)

    def large_rewrite(self) -> bool:
        edit_count = sum(1 for b in self._payload.blocks if b.role == "edit")
        return self.targeted_edit_blocks() * 2 > edit_count

    # -- protection -----------------------------------------------------------

    def _protection(self, op: Op, new_blocks: list[Block]) -> tuple[str | None, list[str]]:
        flags: list[str] = []
        has_targets = op.kind in ("replace", "delete", "move")

        old_blocks: list[Block] = []
        if has_targets:
            for bid in op.targets:
                md = self._block_md.get(bid, "")
                if md:
                    pr = parse_markdown(md)
                    old_blocks.extend(pr.doc.blocks)

        old_blanks: list[tuple[str, ...]] = _collect_blanks(old_blocks) if has_targets else []
        new_blanks: list[tuple[str, ...]] = _collect_blanks(new_blocks)

        # --- Violations (checked in order) ---
        code: str | None = None
        if has_targets:
            if any(isinstance(b, TeacherNote) for b in old_blocks):
                code = "protected_note"
            elif any(isinstance(b, RawBlock) for b in old_blocks):
                code = "protected_raw"
            elif op.kind == "replace":
                # tick_changed
                old_opts = _collect_mcq_options(old_blocks)
                new_opts = _collect_mcq_options(new_blocks)
                old_ticked = [t for t, c in old_opts if c]
                old_unticked = [t for t, c in old_opts if not c]
                new_ticked = [t for t, c in new_opts if c]

                tick_violation = False
                for ot in old_ticked:
                    if not any(_tick_similar(ot, nt) for nt in new_ticked):
                        tick_violation = True
                        break
                if not tick_violation:
                    for nt in new_ticked:
                        if any(_tick_similar(nt, ou) for ou in old_unticked) and not any(
                            _tick_similar(nt, ot) for ot in old_ticked
                        ):
                            tick_violation = True
                            break
                if tick_violation:
                    code = "tick_changed"

                # answer_changed
                if code is None:
                    if len(old_blanks) == len(new_blanks):
                        if old_blanks != new_blanks:
                            code = "answer_changed"
                    else:
                        shorter = old_blanks if len(old_blanks) < len(new_blanks) else new_blanks
                        longer = new_blanks if len(old_blanks) < len(new_blanks) else old_blanks
                        if not Counter(shorter) <= Counter(longer):
                            code = "answer_changed"

        # --- Flags ---
        # "ai_answer": replace/insert
        if op.kind in ("replace", "insert"):
            old_blanks_ai = old_blanks if has_targets else []
            old_counter = Counter(old_blanks_ai)
            new_counter = Counter(new_blanks)
            ai = False
            for ans, cnt in new_counter.items():
                if cnt > old_counter.get(ans, 0):
                    ai = True
                    break
            if not ai:
                old_opts = _collect_mcq_options(old_blocks) if has_targets else []
                new_opts = _collect_mcq_options(new_blocks)
                old_ticked = [t for t, c in old_opts if c]
                new_ticked = [t for t, c in new_opts if c]
                for nt in new_ticked:
                    if not any(_tick_similar(nt, ot) for ot in old_ticked):
                        ai = True
                        break
            if ai:
                flags.append("ai_answer")

        # "removes_blank": replace/delete
        if op.kind in ("replace", "delete"):
            if len(old_blanks) > len(new_blanks):
                flags.append("removes_blank")

        # "removes_text": delete
        if op.kind == "delete":
            flags.append("removes_text")

        # "removes_a_lot": replace
        if op.kind == "replace" and op.markdown is not None:
            old_md = "\n\n".join(self._block_md.get(bid, "") for bid in op.targets).strip()
            new_md = op.markdown.strip()
            if len(old_md) >= 40 and len(new_md) < 0.4 * len(old_md):
                flags.append("removes_a_lot")

        return (code, flags)

    # -- step 5: structure checks --------------------------------------------

    def _check_structure(self, blocks: list[Block], markdown: str | None) -> str | None:
        all_blocks = _walk_blocks(tuple(blocks))

        # blank_empty (including unclosed {{ / }} left as plain text)
        for b in all_blocks:
            if self._has_blank_empty(b):
                return "blank_empty"
        for b in all_blocks:
            for content in _inline_contents(b):
                for inline in content:
                    if isinstance(inline, Text) and ("{{" in inline.text or "}}" in inline.text):
                        return "blank_empty"

        # mcq_shape / mcq_no_answer / mcq_dup_option
        for b in all_blocks:
            if isinstance(b, Mcq):
                code = self._check_mcq(b)
                if code is not None:
                    return code

        # broken MCQ in list items
        for b in all_blocks:
            if isinstance(b, (BulletList, OrderedList)):
                for item in b.items:
                    txt = _content_text(item.content)
                    if txt.startswith("[ ] ") or txt.startswith("[x] "):
                        return "mcq_shape"

        # table_shape
        for b in all_blocks:
            if isinstance(b, Table):
                counts = {len(row) for row in b.rows}
                if len(counts) > 1:
                    return "table_shape"

        # note_shape
        note_line_count = sum(
            1 for line in (markdown or "").splitlines() if _NOTE_START_RE.match(line)
        )
        all_notes = [b for b in _walk_blocks(tuple(blocks)) if isinstance(b, TeacherNote)]
        if note_line_count != len(all_notes):
            return "note_shape"
        for b in all_notes:
            code = self._check_note(b)
            if code is not None:
                return "note_shape"

        return None

    def _has_blank_empty(self, block: Block) -> bool:
        # Check all inline content in the block for empty blanks
        for content in _inline_contents(block):
            for inline in content:
                if isinstance(inline, Blank):
                    if all(not a.strip() for a in inline.answers):
                        return True
        return False

    def _check_mcq(self, mcq: Mcq) -> str | None:
        # mcq_shape: empty question or < 2 options
        if not _has_text(mcq.question):
            return "mcq_shape"
        if len(mcq.options) < 2:
            return "mcq_shape"
        # mcq_no_answer
        if not any(o.correct for o in mcq.options):
            return "mcq_no_answer"
        # mcq_dup_option
        seen: set[str] = set()
        for o in mcq.options:
            key = _content_text(o.content).strip().casefold()
            if key in seen:
                return "mcq_dup_option"
            seen.add(key)
        return None

    def _check_note(self, note: TeacherNote) -> str | None:
        # no tag
        if note.tag is None or note.tag.strip() == "":
            return "note_shape"
        # blocks all empty
        if note.blocks and all(not _block_text(b).strip() for b in note.blocks):
            return "note_shape"
        if not note.blocks:
            return "note_shape"
        # plain text over 4000
        total = sum(len(_block_text(b)) for b in note.blocks)
        if total > 4000:
            return "note_shape"
        return None

    # -- step 6: page-split checks -------------------------------------------

    def _check_split(self, op: Op, new_blocks: list[Block]) -> str | None:
        # Determine if this op involves a SplitPoint (new or old blocks)
        has_split_new = any(isinstance(b, SplitPoint) for b in new_blocks)
        has_split_old = self._targets_have_split(op)
        has_inline_split = op.markdown is not None and any(
            _SPLIT_INLINE_RE.match(line) for line in op.markdown.splitlines()
        )
        if not has_split_new and not has_split_old and not has_inline_split:
            return None

        # Inline split-line count vs parsed SplitPoint count
        if new_blocks and op.markdown is not None:
            sp_count = sum(1 for b in new_blocks if isinstance(b, SplitPoint))
            inline_count = sum(
                1 for line in op.markdown.splitlines() if _SPLIT_INLINE_RE.match(line)
            )
            if inline_count != sp_count:
                return "split_place"

            # split_label
            for b in new_blocks:
                if isinstance(b, SplitPoint):
                    if not b.label or len(b.label) > 80:
                        return "split_label"

        # Build resulting sequence and check global split constraints
        sequence = self._build_sequence(op, new_blocks)
        if sequence is None:
            return None

        split_points = [b for b, _ in sequence if isinstance(b, SplitPoint)]
        if len(split_points) > 1:
            return "split_count"

        if split_points:
            if isinstance(sequence[0][0], SplitPoint):
                if self._payload.blocks and self._payload.blocks[0].id == "b1":
                    return "split_place"
            if isinstance(sequence[-1][0], SplitPoint):
                if self._payload.scope == "lesson":
                    return "split_place"

        return None

    def _targets_have_split(self, op: Op) -> bool:
        """Check whether the old (target) blocks contain a SplitPoint."""
        for bid in op.targets:
            md = self._block_md.get(bid, "")
            if not md:
                continue
            pr = parse_markdown(md)
            if any(isinstance(b, SplitPoint) for b in pr.doc.blocks):
                return True
        return False

    def _build_sequence(self, op: Op, new_blocks: list[Block]) -> list[tuple[Block, str]] | None:
        """Build the full top-level block sequence with the op applied."""
        # Parse every payload block
        seq: list[tuple[Block, str]] = []
        for pb in self._payload.blocks:
            pr = parse_markdown(pb.md)
            for b in pr.doc.blocks:
                seq.append((b, pb.id))

        if not seq:
            return seq

        # Identify indices
        target_idx: set[int] = set()
        first_target_idx: int | None = None
        for i, (_, bid) in enumerate(seq):
            if bid in op.targets:
                target_idx.add(i)
                if first_target_idx is None:
                    first_target_idx = i

        anchor_idx: set[int] = set()
        if op.anchor is not None:
            for i, (_, bid) in enumerate(seq):
                if bid == op.anchor:
                    anchor_idx.add(i)

        # Apply op
        if op.kind == "replace":
            # Remove all target blocks, insert new at first target's position
            pos = first_target_idx if first_target_idx is not None else 0
            remaining = [(b, bid) for i, (b, bid) in enumerate(seq) if i not in target_idx]
            insert_at = sum(1 for i in range(pos) if i not in target_idx)
            for nb in new_blocks:
                remaining.insert(insert_at, (nb, op.targets[0] if op.targets else "new"))
                insert_at += 1
            return remaining

        if op.kind == "insert":
            # Insert before/after anchor
            if not anchor_idx:
                return None
            if op.side == "before":
                pos = min(anchor_idx)
            else:
                pos = max(anchor_idx) + 1
            for j, nb in enumerate(new_blocks):
                seq.insert(pos + j, (nb, op.anchor or "new"))
            return seq

        if op.kind == "delete":
            return [(b, bid) for i, (b, bid) in enumerate(seq) if i not in target_idx]

        if op.kind == "move":
            moved = [(b, bid) for i, (b, bid) in enumerate(seq) if i in target_idx]
            remaining = [(b, bid) for i, (b, bid) in enumerate(seq) if i not in target_idx]
            if not anchor_idx:
                return remaining
            if op.side == "before":
                # Find anchor's first position in remaining
                pos = next(
                    (i for i, (_, bid) in enumerate(remaining) if bid == op.anchor),
                    len(remaining),
                )
            else:
                # Find anchor's last position in remaining
                positions = [i for i, (_, bid) in enumerate(remaining) if bid == op.anchor]
                pos = positions[-1] + 1 if positions else len(remaining)
            for j, item in enumerate(moved):
                remaining.insert(pos + j, item)
            return remaining

        return seq
