"""Tests for project_student (student projection)."""

from __future__ import annotations

import dataclasses
from typing import cast

from docuteach.md.model import (
    Blank,
    Doc,
    Heading,
    ListItem,
    Mcq,
    McqOption,
    Meta,
    OrderedList,
    Paragraph,
    RawBlock,
    SplitPoint,
    Style,
    TeacherNote,
    Text,
)
from docuteach.md.project import (
    StudentBlank,
    StudentMcq,
    StudentParagraph,
    StudentText,
    project_student,
)

# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------


def _assert_no_markers(node: object, markers: tuple[str, ...]) -> None:
    """Recursively walk dataclasses/tuples; assert no marker in any node's repr."""
    r = repr(node)
    for m in markers:
        assert m not in r, f"Marker {m!r} found in {type(node).__name__}"
    if dataclasses.is_dataclass(node) and not isinstance(node, type):
        for f in dataclasses.fields(node):
            _assert_no_markers(getattr(node, f.name), markers)
    elif isinstance(node, tuple):
        items = cast("tuple[object, ...]", node)
        for item in items:
            _assert_no_markers(item, markers)


# ---------------------------------------------------------------------------
# Fixtures / builders
# ---------------------------------------------------------------------------


def _build_doc() -> Doc:
    return Doc(
        meta=Meta(raw="MARK_FRONT_MATTER", data={"key": "MARK_FRONT_MATTER"}),
        blocks=(
            Heading(level=2, content=(Text(text="Section one"),)),
            Paragraph(
                content=(
                    Text(text="Intro ", style=Style(font="serif")),
                    Blank(answers=("MARK_ANSWER",), style=Style(size=14.0)),
                    Text(text=" end"),
                ),
            ),
            TeacherNote(
                tag="MARK_NOTE_TAG",
                blocks=(Paragraph(content=(Text(text="MARK_NOTE_TEXT"),)),),
            ),
            OrderedList(
                items=(ListItem(content=(Text(text="A question."),)),),
            ),
            Mcq(
                question=(Text(text="Pick one:"),),
                options=(
                    McqOption(content=(Text(text="MARK_OPT_WRONG"),), correct=False),
                    McqOption(content=(Text(text="MARK_OPT_RIGHT"),), correct=True),
                ),
                multi=False,
            ),
            TeacherNote(
                tag="Distractors",
                blocks=(Paragraph(content=(Text(text="MARK_DISTRACTOR_TEXT"),)),),
            ),
            RawBlock(text="MARK_RAW_TEXT"),
            SplitPoint(label="MARK_SPLIT_LABEL"),
            Paragraph(
                content=(
                    Text(text="Styled ", style=Style(font="mono", size=12.0)),
                    Blank(style=Style(font="serif")),
                ),
            ),
        ),
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_no_teacher_markers_in_student_doc() -> None:
    doc = _build_doc()
    student = project_student(doc)
    markers = (
        "MARK_ANSWER",
        "MARK_NOTE_TEXT",
        "MARK_NOTE_TAG",
        "MARK_RAW_TEXT",
        "MARK_SPLIT_LABEL",
        "MARK_FRONT_MATTER",
        "MARK_DISTRACTOR_TEXT",
    )
    _assert_no_markers(student, markers)


def test_student_visible_content_preserved() -> None:
    doc = _build_doc()
    student = project_student(doc)
    r = repr(student)
    assert "MARK_OPT_WRONG" in r
    assert "MARK_OPT_RIGHT" in r


def test_empty_doc_gives_one_empty_paragraph() -> None:
    doc = Doc(meta=Meta(), blocks=())
    student = project_student(doc)
    assert len(student.blocks) == 1
    assert isinstance(student.blocks[0], StudentParagraph)
    assert student.blocks[0].content == ()


def test_style_kept_on_text_and_blank() -> None:
    doc = Doc(
        meta=Meta(),
        blocks=(
            Paragraph(
                content=(
                    Text(text="styled", style=Style(font="serif", size=16.0)),
                    Blank(style=Style(font="mono")),
                ),
            ),
        ),
    )
    student = project_student(doc)
    p = student.blocks[0]
    assert isinstance(p, StudentParagraph)
    assert len(p.content) == 2
    t = p.content[0]
    assert isinstance(t, StudentText)
    assert t.style == Style(font="serif", size=16.0)
    b = p.content[1]
    assert isinstance(b, StudentBlank)
    assert b.style == Style(font="mono")


def test_multi_stays_true() -> None:
    doc = Doc(
        meta=Meta(),
        blocks=(
            Mcq(
                question=(Text(text="Q"),),
                options=(
                    McqOption(content=(Text(text="a"),), correct=True),
                    McqOption(content=(Text(text="b"),), correct=False),
                ),
                multi=True,
            ),
        ),
    )
    student = project_student(doc)
    mcq = student.blocks[0]
    assert isinstance(mcq, StudentMcq)
    assert mcq.multi is True


def test_multi_derived_from_correct_count() -> None:
    doc = Doc(
        meta=Meta(),
        blocks=(
            Mcq(
                question=(Text(text="Q"),),
                options=(
                    McqOption(content=(Text(text="a"),), correct=True),
                    McqOption(content=(Text(text="b"),), correct=True),
                    McqOption(content=(Text(text="c"),), correct=False),
                ),
                multi=False,
            ),
        ),
    )
    student = project_student(doc)
    mcq = student.blocks[0]
    assert isinstance(mcq, StudentMcq)
    assert mcq.multi is True


def test_multi_false_when_single_correct() -> None:
    doc = Doc(
        meta=Meta(),
        blocks=(
            Mcq(
                question=(Text(text="Q"),),
                options=(
                    McqOption(content=(Text(text="a"),), correct=True),
                    McqOption(content=(Text(text="b"),), correct=False),
                ),
                multi=False,
            ),
        ),
    )
    student = project_student(doc)
    mcq = student.blocks[0]
    assert isinstance(mcq, StudentMcq)
    assert mcq.multi is False
