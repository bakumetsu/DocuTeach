"""Unlocked teacher notes: parsing, edit check and model prompt view."""

from __future__ import annotations

from docuteach.edits import EditBlock, EditPayload
from docuteach.edits.check import Checked, OpChecker
from docuteach.edits.ops import Op, Skip
from docuteach.edits.prompt import build_view
from docuteach.md.model import TeacherNote
from docuteach.md.parser import parse_markdown

LOCKED = '::: teacher {tag="CCQ"}\nAsk why.\n:::'
UNLOCKED = '::: teacher {tag="CCQ" unlocked="true"}\nAsk why.\n:::'
UNLOCKED_NO_TAG = '::: teacher {unlocked="true"}\nAsk why.\n:::'
BARE = "::: teacher\nAsk why.\n:::"


def _payload(md: str) -> EditPayload:
    return EditPayload(
        instruction="",
        scope="lesson",
        allowProtected=False,
        blocks=[EditBlock(id="b1", kind="x", md=md, role="edit")],
    )


def _code(r: Checked | Skip | None) -> str | None:
    return r.code if isinstance(r, Skip) else None


def _replace(md: str | None) -> Op:
    return Op("replace", ("b1",), None, None, md, "@@ replace b1 @@")


def _check(old: str, new: str | None) -> str | None:
    return _code(OpChecker(_payload(old)).check(_replace(new)))


def _note(md: str) -> TeacherNote:
    note = parse_markdown(md).doc.blocks[0]
    assert isinstance(note, TeacherNote)
    return note


def test_parse_unlocked_flag() -> None:
    assert _note(UNLOCKED).unlocked is True
    assert _note(UNLOCKED).tag == "CCQ"
    assert _note(UNLOCKED_NO_TAG).unlocked is True
    assert _note(LOCKED).unlocked is False
    assert _note(BARE).unlocked is False


def test_empty_attr_block_is_not_a_note() -> None:
    blocks = parse_markdown("::: teacher {}\nAsk why.\n:::").doc.blocks
    assert not any(isinstance(b, TeacherNote) for b in blocks)


def test_unlocked_note_may_be_rewritten() -> None:
    assert _check(UNLOCKED, UNLOCKED.replace("Ask why.", "Ask when.")) is None


def test_unlocked_note_cannot_be_relocked() -> None:
    assert _check(UNLOCKED, LOCKED) == "protected_note"


def test_unlocked_note_cannot_be_retagged() -> None:
    assert _check(UNLOCKED, UNLOCKED.replace("CCQ", "ICQ")) == "protected_note"


def test_unlocked_note_cannot_change_type() -> None:
    assert _check(UNLOCKED, "Plain text") == "protected_note"


def test_unlocked_note_cannot_be_deleted() -> None:
    r = OpChecker(_payload(UNLOCKED)).check(
        Op("delete", ("b1",), None, None, None, "@@ delete b1 @@")
    )
    assert _code(r) == "protected_note"


def test_locked_note_still_rejected() -> None:
    assert _check(LOCKED, "Text") == "protected_note"
    assert _check(LOCKED, UNLOCKED) == "protected_note"


def test_prompt_view_hides_locked_only() -> None:
    assert "protected: teacher note" in build_view(_payload(LOCKED))
    view = build_view(_payload(UNLOCKED))
    assert "protected" not in view
    assert "Ask why." in view
