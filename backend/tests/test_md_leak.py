"""Verify no teacher-only strings leak into the student projection."""

from __future__ import annotations

import dataclasses
from pathlib import Path
from typing import cast

import pytest

from docuteach.md.model import (
    Blank,
    Block,
    BulletList,
    Doc,
    Heading,
    Inline,
    Mcq,
    OrderedList,
    Paragraph,
    RawBlock,
    SplitPoint,
    Style,
    Table,
    TeacherNote,
    Text,
)
from docuteach.md.parser import parse_markdown
from docuteach.md.project import (
    StudentBlank,
    StudentMcq,
    StudentOption,
    StudentText,
    project_student,
)

FIXTURES = Path(__file__).resolve().parents[2] / "frontend" / "test" / "fixtures"
GOLDENS = Path(__file__).parent / "golden"


def _require_fixtures() -> None:
    if not FIXTURES.is_dir() or not any(FIXTURES.glob("*.md")):
        pytest.fail("frontend fixtures not found")


# ---------------------------------------------------------------------------
# Secret collection helpers
# ---------------------------------------------------------------------------


def _walk_inline(inlines: tuple[Inline, ...], secrets: set[str], in_note: bool) -> None:
    for inline in inlines:
        if isinstance(inline, Text) and in_note:
            secrets.add(inline.text)
        elif isinstance(inline, Blank):
            for a in inline.answers:
                secrets.add(a)


def _walk_blocks(blocks: tuple[Block, ...], secrets: set[str], in_note: bool) -> None:
    for block in blocks:
        if isinstance(block, TeacherNote):
            if block.tag is not None:
                secrets.add(block.tag)
            _walk_blocks(block.blocks, secrets, True)
        elif isinstance(block, SplitPoint):
            if block.label != "Homework starts here":
                secrets.add(block.label)
        elif isinstance(block, RawBlock):
            secrets.add(block.text)
        elif isinstance(block, (Heading, Paragraph)):
            _walk_inline(block.content, secrets, in_note)
        elif isinstance(block, (BulletList, OrderedList)):
            for item in block.items:
                _walk_inline(item.content, secrets, in_note)
                _walk_blocks(item.nested, secrets, in_note)
        elif isinstance(block, Table):
            for row in block.rows:
                for cell in row:
                    _walk_inline(cell.content, secrets, in_note)
        else:  # Mcq
            _walk_inline(block.question, secrets, in_note)
            # Option content text is visible to students; not a secret.


def _collect_secrets(doc: Doc) -> set[str]:
    secrets: set[str] = set()
    _walk_blocks(doc.blocks, secrets, False)
    return secrets


# ---------------------------------------------------------------------------
# Fixture-based leak test
# ---------------------------------------------------------------------------


def _collect_visible_text(doc: Doc) -> str:
    """Collect text from all Text nodes in non-TeacherNote / non-RawBlock blocks."""
    parts: list[str] = []

    def _walk(blocks: tuple[Block, ...]) -> None:
        for block in blocks:
            if isinstance(block, (TeacherNote, RawBlock)):
                continue
            if isinstance(block, (Heading, Paragraph)):
                for inline in block.content:
                    if isinstance(inline, Text):
                        parts.append(inline.text)
            elif isinstance(block, (BulletList, OrderedList)):
                for item in block.items:
                    for inline in item.content:
                        if isinstance(inline, Text):
                            parts.append(inline.text)
                    _walk(item.nested)
            elif isinstance(block, Table):
                for row in block.rows:
                    for cell in row:
                        for inline in cell.content:
                            if isinstance(inline, Text):
                                parts.append(inline.text)
            elif isinstance(block, Mcq):
                for inline in block.question:
                    if isinstance(inline, Text):
                        parts.append(inline.text)
                for opt in block.options:
                    for inline in opt.content:
                        if isinstance(inline, Text):
                            parts.append(inline.text)

    _walk(doc.blocks)
    return " ".join(parts)


def test_no_secret_leak_in_fixtures() -> None:
    _require_fixtures()
    for path in sorted(FIXTURES.glob("*.md")):
        text = path.read_text(encoding="utf-8")
        doc = parse_markdown(text).doc
        student = project_student(doc)
        rep = repr(student)
        visible = _collect_visible_text(doc)
        for secret in _collect_secrets(doc):
            if len(secret) < 3:
                continue
            if secret in visible:
                continue
            assert secret not in rep, (
                f"Secret {secret!r} leaked in student doc from {path.name}"
            )


# ---------------------------------------------------------------------------
# Explicit leak test
# ---------------------------------------------------------------------------


def test_explicit_secret_leak() -> None:
    md = (
        "Fill in {{SECRET-ANSWER}} here.\n"
        "\n"
        "::: teacher {tag=\"Notes\"}\n"
        "SECRET-NOTE\n"
        ":::\n"
        "\n"
        "::: teacher {tag=\"Notes\"}\n"
        "Look at [x]{font=\"ZZ-FONT-9\"}\n"
        ":::\n"
        "\n"
        "Q1.\n"
        "- [x] Right\n"
        "- [ ] Wrong\n"
    )
    doc = parse_markdown(md).doc
    student = project_student(doc)
    rep = repr(student)

    # Secret strings must not appear
    assert "SECRET-NOTE" not in rep
    assert "SECRET-ANSWER" not in rep
    assert "ZZ-FONT-9" not in rep

    # StudentOption fields
    option_fields = {f.name for f in dataclasses.fields(StudentOption)}
    assert option_fields == {"content", "letter"}

    # StudentBlank fields
    blank_fields = {f.name for f in dataclasses.fields(StudentBlank)}
    assert blank_fields == {"style"}

    # Every StudentOption in the projected doc has exactly those fields
    for block in student.blocks:
        if isinstance(block, StudentMcq):
            for opt in block.options:
                assert {f.name for f in dataclasses.fields(opt)} == {"content", "letter"}

    # Every StudentBlank in the projected doc has exactly "style"
    _check_blanks(student.blocks)



def _check_blanks(blocks: tuple[object, ...]) -> None:
    for b in blocks:
        if isinstance(b, StudentBlank):
            assert {f.name for f in dataclasses.fields(b)} == {"style"}
        for attr in ("content", "items", "nested", "rows", "options", "blocks"):
            val = getattr(b, attr, None)
            if isinstance(val, tuple):
                _check_blanks(cast("tuple[object, ...]", val))


def _collect(node: object, out: list[object]) -> None:
    out.append(node)
    if isinstance(node, tuple):
        for item in cast("tuple[object, ...]", node):
            _collect(item, out)
    elif dataclasses.is_dataclass(node) and not isinstance(node, type):
        for f in dataclasses.fields(node):
            _collect(getattr(node, f.name), out)


def test_styled_blank_and_option_keep_style() -> None:
    source = (
        'Fill [{{has lived}}]{size=16} now.\n'
        "\n"
        "Which fits?\n"
        "- [ ] three\n"
        '- [x] [has lived]{font="Roboto"}\n'
        "- [ ] plain\n"
    )
    doc = parse_markdown(source).doc
    student = project_student(doc)

    all_nodes: list[object] = []
    _collect(student, all_nodes)

    # A styled blank keeps its Style (size=16).
    assert StudentBlank(style=Style(font=None, size=16.0)) in all_nodes

    # A styled option Text keeps its Style (font="Roboto").
    expected_option = StudentText(
        text="has lived", marks=(), style=Style(font="Roboto", size=None)
    )
    assert expected_option in all_nodes

    # "has lived" appears only as that option text, not as a blank answer.
    # StudentBlank has only the field "style" so it structurally cannot hold text.
    for node in all_nodes:
        if isinstance(node, StudentBlank):
            assert {f.name for f in dataclasses.fields(node)} == {"style"}
    matching = [
        n for n in all_nodes
        if isinstance(n, StudentText) and n.text == "has lived"
    ]
    assert len(matching) == 1
    assert matching[0] == expected_option



