"""Tests for OpChecker in docuteach.edits.check."""

from __future__ import annotations

from typing import Literal

from docuteach.edits import EditBlock, EditPayload
from docuteach.edits.check import Checked, OpChecker
from docuteach.edits.ops import Op, Skip

# ---------------------------------------------------------------------------
# Markdown snippets
# ---------------------------------------------------------------------------

BLANK = "She {{went}} home."
MCQ = "Pick one:\n- [x] cat\n- [ ] dog"
NOTE = '::: teacher {tag="CCQ"}\nAsk why.\n:::'
SPLIT = "<!-- split: Homework -->"
TABLE = "| a | b |\n|---|---|\n| 1 | 2 |"
RAW = "::: unknown\ntext\n:::"
UNCLOSED = "She {{went home."
FRONT = "---\ntitle: x\n---\n\nText"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def payload(
    blocks: list[tuple[str, str]],
    *,
    scope: Literal["selection", "section", "lesson"] = "lesson",
    lock_off: bool = True,
    roles: dict[str, Literal["edit", "context"]] | None = None,
) -> EditPayload:
    bl: list[EditBlock] = []
    for bid, md in blocks:
        role: Literal["edit", "context"] = "edit"
        if roles is not None and bid in roles:
            role = roles[bid]
        bl.append(EditBlock(id=bid, kind="x", md=md, role=role))
    return EditPayload(
        instruction="",
        scope=scope,
        allowProtected=not lock_off,
        blocks=bl,
    )


def replace(bid: str, md: str | None) -> Op:
    return Op("replace", (bid,), None, None, md, f"@@ replace {bid} @@")


def insert(anchor: str, md: str | None, side: str = "after") -> Op:
    return Op("insert", (), anchor, side, md, f"@@ insert {side} {anchor} @@")


def delete(*ids: str) -> Op:
    return Op("delete", ids, None, None, None, f"@@ delete {ids[0]} @@")


def move(ids: tuple[str, ...], anchor: str, side: str = "after") -> Op:
    return Op("move", ids, anchor, side, None, f"@@ move {ids[0]} {side} {anchor} @@")


def code(r: Checked | Skip | None) -> str | None:
    if isinstance(r, Skip):
        return r.code
    return None


# ---------------------------------------------------------------------------
# Structure / parse checks
# ---------------------------------------------------------------------------


def test_parse_warning() -> None:
    p = payload([("b1", "Hello")])
    c = OpChecker(p)
    assert code(c.check(replace("b1", '::: teacher {tag="X"}\nAsk why.'))) == "parse_warning"


def test_unclosed_blank() -> None:
    p = payload([("b1", "Hello")])
    c = OpChecker(p)
    assert code(c.check(replace("b1", UNCLOSED))) == "blank_empty"


def test_front_matter() -> None:
    p = payload([("b1", "Hello")])
    c = OpChecker(p)
    assert code(c.check(replace("b1", FRONT))) == "front_matter"


def test_raw_block() -> None:
    p = payload([("b1", "Hello")])
    c = OpChecker(p)
    assert code(c.check(replace("b1", RAW))) == "raw_block"


def test_unknown_block() -> None:
    p = payload([("b1", "Hello")])
    c = OpChecker(p)
    assert code(c.check(replace("b9", "World"))) == "unknown_block"


def test_out_of_scope_role() -> None:
    p = payload([("b1", "Hello"), ("b2", "World")], roles={"b1": "context"})
    c = OpChecker(p)
    assert code(c.check(replace("b1", "World"))) == "out_of_scope"


def test_out_of_scope_insert_anchor() -> None:
    p = payload([("b1", "Hello"), ("b2", "World")], roles={"b1": "context"})
    c = OpChecker(p)
    assert code(c.check(insert("b1", "New"))) == "out_of_scope"


def test_overlap_two_replaces() -> None:
    p = payload([("b1", "Hello")])
    c = OpChecker(p)
    c.check(replace("b1", "World"))
    assert code(c.check(replace("b1", "Again"))) == "overlap"


def test_overlap_move_anchor_is_target() -> None:
    p = payload([("b1", "Hello"), ("b2", "World")])
    c = OpChecker(p)
    assert code(c.check(move(("b1",), "b1"))) == "overlap"


def test_empty_body_none() -> None:
    p = payload([("b1", "Hello")])
    c = OpChecker(p)
    assert code(c.check(replace("b1", None))) == "empty_body"


def test_empty_body_blank() -> None:
    p = payload([("b1", "Hello")])
    c = OpChecker(p)
    assert code(c.check(replace("b1", "   "))) == "empty_body"


def test_too_long_chars() -> None:
    p = payload([("b1", "Hello")])
    c = OpChecker(p)
    assert code(c.check(replace("b1", "x" * 9000))) == "too_long"


def test_too_long_paragraphs() -> None:
    p = payload([("b1", "Hello")])
    c = OpChecker(p)
    md = "\n\n".join(f"Paragraph {i}." for i in range(31))
    assert code(c.check(replace("b1", md))) == "too_long"


def test_blank_empty() -> None:
    p = payload([("b1", "Hello")])
    c = OpChecker(p)
    assert code(c.check(replace("b1", "She {{ }} home."))) == "blank_empty"


def test_mcq_shape_broken_list() -> None:
    p = payload([("b1", "Hello")])
    c = OpChecker(p)
    assert code(c.check(replace("b1", "Pick one:\n- [x] only"))) == "mcq_shape"


def test_mcq_shape_no_question() -> None:
    p = payload([("b1", "Hello")])
    c = OpChecker(p)
    md = "- [x] cat\n- [ ] dog"
    assert code(c.check(replace("b1", md))) == "mcq_shape"


def test_mcq_no_answer() -> None:
    p = payload([("b1", "Hello")])
    c = OpChecker(p)
    md = "Pick one:\n- [ ] cat\n- [ ] dog"
    assert code(c.check(replace("b1", md))) == "mcq_no_answer"


def test_mcq_dup_option() -> None:
    p = payload([("b1", "Hello")])
    c = OpChecker(p)
    md = "Pick one:\n- [x] cat\n- [ ] cat"
    assert code(c.check(replace("b1", md))) == "mcq_dup_option"


def test_table_shape() -> None:
    from docuteach.md.model import Table, TableCell, Text

    p = payload([("b1", "Hello")])
    c = OpChecker(p)
    table = Table(
        rows=(
            (TableCell((Text("a"),)), TableCell((Text("b"),))),
            (TableCell((Text("1"),)),),
        )
    )
    result = c._check_structure([table], None)  # pyright: ignore[reportPrivateUsage]
    assert result == "table_shape"


def test_split_count() -> None:
    p = payload([("b1", SPLIT), ("b2", "Hello")])
    c = OpChecker(p)
    assert code(c.check(replace("b2", "<!-- split: Other -->"))) == "split_count"


def test_split_label() -> None:
    p = payload([("b1", "Hello")], scope="section")
    c = OpChecker(p)
    label = "x" * 81
    assert code(c.check(replace("b1", f"<!-- split: {label} -->"))) == "split_label"


def test_split_place_first_block() -> None:
    p = payload([("b1", "Hello"), ("b2", "World")], scope="lesson")
    c = OpChecker(p)
    assert code(c.check(insert("b1", SPLIT, side="before"))) == "split_place"


def test_split_place_first_block_non_lesson() -> None:
    p = payload([("b1", "Hello"), ("b2", "World")], scope="selection")
    c = OpChecker(p)
    r = c.check(insert("b1", SPLIT, side="before"))
    assert isinstance(r, Checked)


def test_split_place_inside_note() -> None:
    p = payload([("b1", NOTE)])
    c = OpChecker(p)
    md = '::: teacher {tag="X"}\ntext\n<!-- split: Y -->\nmore\n:::'
    assert code(c.check(replace("b1", md))) == "split_place"


def test_note_shape_no_tag() -> None:
    p = payload([("b1", "Hello")])
    c = OpChecker(p)
    md = "::: teacher\nAsk why.\n:::"
    assert code(c.check(replace("b1", md))) == "note_shape"


def test_note_shape_nested() -> None:
    p = payload([("b1", "Hello")])
    c = OpChecker(p)
    md = '::: teacher {tag="X"}\n::: teacher {tag="Y"}\ninner\n:::\nouter\n:::'
    assert code(c.check(replace("b1", md))) == "note_shape"


# ---------------------------------------------------------------------------
# No-change and success
# ---------------------------------------------------------------------------


def test_no_change() -> None:
    p = payload([("b1", "Hello world.")])
    c = OpChecker(p)
    r = c.check(replace("b1", "Hello world."))
    assert r is None
    assert c.no_change == 1


def test_success_replace() -> None:
    p = payload([("b1", "Hello")])
    c = OpChecker(p)
    r = c.check(replace("b1", "World."))
    assert isinstance(r, Checked)
    assert r.flags == ()


def test_success_insert_note() -> None:
    p = payload([("b1", "Hello")], scope="section")
    c = OpChecker(p)
    r = c.check(insert("b1", NOTE))
    assert isinstance(r, Checked)
    assert r.flags == ()


# ---------------------------------------------------------------------------
# Protection
# ---------------------------------------------------------------------------


def test_protected_note_replace() -> None:
    p = payload([("b1", NOTE)], lock_off=True)
    c = OpChecker(p)
    assert code(c.check(replace("b1", "Text"))) == "protected_note"


def test_protected_note_delete() -> None:
    p = payload([("b1", NOTE)], lock_off=True)
    c = OpChecker(p)
    assert code(c.check(delete("b1"))) == "protected_note"


def test_protected_note_move() -> None:
    p = payload([("b1", NOTE), ("b2", "Hello")], lock_off=True)
    c = OpChecker(p)
    assert code(c.check(move(("b1",), "b2"))) == "protected_note"


def test_protected_note_range() -> None:
    p = payload([("b1", "Hello"), ("b2", NOTE)], lock_off=True)
    c = OpChecker(p)
    op = Op("replace", ("b1", "b2"), None, None, "Text", "@@ replace b1-b2 @@")
    assert code(c.check(op)) == "protected_note"


def test_protected_note_lock_on() -> None:
    p = payload([("b1", NOTE)], lock_off=False)
    c = OpChecker(p)
    r = c.check(replace("b1", "Text"))
    assert isinstance(r, Checked)
    assert "changes_protected" in r.flags


def test_protected_raw() -> None:
    p = payload([("b1", RAW)], lock_off=True)
    c = OpChecker(p)
    assert code(c.check(replace("b1", "Text"))) == "protected_raw"


def test_protected_raw_lock_on() -> None:
    p = payload([("b1", RAW)], lock_off=False)
    c = OpChecker(p)
    r = c.check(replace("b1", "Text"))
    assert isinstance(r, Checked)
    assert "changes_protected" in r.flags


def test_tick_changed() -> None:
    p = payload([("b1", MCQ)], lock_off=True)
    c = OpChecker(p)
    new = "Pick one:\n- [ ] cat\n- [x] dog"
    assert code(c.check(replace("b1", new))) == "tick_changed"


def test_tick_changed_lock_on() -> None:
    p = payload([("b1", MCQ)], lock_off=False)
    c = OpChecker(p)
    new = "Pick one:\n- [ ] cat\n- [x] dog"
    r = c.check(replace("b1", new))
    assert isinstance(r, Checked)
    assert "changes_protected" in r.flags


def test_answer_changed() -> None:
    p = payload([("b1", BLANK)], lock_off=True)
    c = OpChecker(p)
    assert code(c.check(replace("b1", "She {{goes}} home."))) == "answer_changed"


def test_answer_changed_lock_on() -> None:
    p = payload([("b1", BLANK)], lock_off=False)
    c = OpChecker(p)
    r = c.check(replace("b1", "She {{goes}} home."))
    assert isinstance(r, Checked)
    assert "changes_protected" in r.flags


def test_tick_reworded_still_ticked() -> None:
    p = payload([("b1", MCQ)])
    c = OpChecker(p)
    new = "Pick one:\n- [x] cats\n- [ ] dog"
    r = c.check(replace("b1", new))
    assert isinstance(r, Checked)
    assert "changes_protected" not in r.flags


def test_blank_unchanged_allowed() -> None:
    p = payload([("b1", BLANK)])
    c = OpChecker(p)
    r = c.check(replace("b1", "He {{went}} home."))
    assert isinstance(r, Checked)
    assert "changes_protected" not in r.flags


def test_blank_count_change_keeps_answers() -> None:
    p = payload([("b1", BLANK)])
    c = OpChecker(p)
    r = c.check(replace("b1", "She {{went}} home. {{went}} again."))
    assert isinstance(r, Checked)
    assert "changes_protected" not in r.flags


# ---------------------------------------------------------------------------
# Flags
# ---------------------------------------------------------------------------


def test_flag_ai_answer_new_blank() -> None:
    p = payload([("b1", "Hello world.")])
    c = OpChecker(p)
    r = c.check(replace("b1", BLANK))
    assert isinstance(r, Checked)
    assert "ai_answer" in r.flags


def test_flag_ai_answer_new_ticked() -> None:
    p = payload([("b1", "Pick one:\n- [ ] cat\n- [ ] dog")], lock_off=False)
    c = OpChecker(p)
    r = c.check(replace("b1", MCQ))
    assert isinstance(r, Checked)
    assert "ai_answer" in r.flags


def test_flag_removes_blank() -> None:
    p = payload([("b1", BLANK)])
    c = OpChecker(p)
    r = c.check(replace("b1", "She went home."))
    assert isinstance(r, Checked)
    assert "removes_blank" in r.flags


def test_flag_removes_text() -> None:
    p = payload([("b1", "Hello")])
    c = OpChecker(p)
    r = c.check(delete("b1"))
    assert isinstance(r, Checked)
    assert "removes_text" in r.flags


def test_flag_removes_a_lot() -> None:
    old = "A" * 100
    p = payload([("b1", old)])
    c = OpChecker(p)
    r = c.check(replace("b1", "B" * 10))
    assert isinstance(r, Checked)
    assert "removes_a_lot" in r.flags


# ---------------------------------------------------------------------------
# Large rewrite
# ---------------------------------------------------------------------------


def test_large_rewrite_true() -> None:
    p = payload([("b1", "Hello"), ("b2", "World"), ("b3", "Foo")])
    c = OpChecker(p)
    c.check(replace("b1", "Hi"))
    c.check(replace("b2", "There"))
    assert c.large_rewrite() is True
    assert c.targeted_edit_blocks() == 2


def test_large_rewrite_false() -> None:
    p = payload([("b1", "Hello"), ("b2", "World"), ("b3", "Foo")])
    c = OpChecker(p)
    c.check(replace("b1", "Hi"))
    assert c.large_rewrite() is False
    assert c.targeted_edit_blocks() == 1
