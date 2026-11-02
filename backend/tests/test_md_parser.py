"""Tests for docuteach.md.parser."""

from __future__ import annotations

from pathlib import Path

from docuteach.md.model import (
    Blank,
    BulletList,
    Heading,
    Mcq,
    Paragraph,
    RawBlock,
    SplitPoint,
    TeacherNote,
    Text,
)
from docuteach.md.parser import parse_markdown

FIXTURES = Path(__file__).resolve().parents[2] / "frontend" / "test" / "fixtures"
GOLDENS = Path(__file__).parent / "golden"


# --- headings ---------------------------------------------------------------


def test_heading_levels() -> None:
    doc, _ = parse_markdown("# One\n\n## Two\n\n### Three\n")
    assert doc.blocks[0] == Heading(level=1, content=(Text("One"),))
    assert doc.blocks[1] == Heading(level=2, content=(Text("Two"),))
    assert doc.blocks[2] == Heading(level=3, content=(Text("Three"),))


# --- inline marks -----------------------------------------------------------


def test_paragraph_marks() -> None:
    doc, _ = parse_markdown("**a** *b* ==c== [d]{.u}\n")
    p = doc.blocks[0]
    assert isinstance(p, Paragraph)
    assert len(p.content) == 7
    assert p.content[0] == Text("a", marks=("bold",))
    assert p.content[2] == Text("b", marks=("italic",))
    assert p.content[4] == Text("c", marks=("highlight",))
    assert p.content[6] == Text("d", marks=("underline",))


# --- blanks -----------------------------------------------------------------


def test_blank_with_answers() -> None:
    doc, _ = parse_markdown("go {{go|goes}} now\n")
    p = doc.blocks[0]
    assert isinstance(p, Paragraph)
    assert Blank(answers=("go", "goes")) in p.content


def test_paragraph_only_blank() -> None:
    doc, _ = parse_markdown("{{go|goes}}\n")
    assert len(doc.blocks) == 1
    assert doc.blocks[0] == Paragraph(content=(Blank(answers=("go", "goes")),))


# --- multiple choice --------------------------------------------------------


def test_mcq_single_correct() -> None:
    src = "What is 2+2?\n- [ ] three\n- [ ] four\n- [x] five\n"
    doc, _ = parse_markdown(src)
    assert len(doc.blocks) == 1
    mcq = doc.blocks[0]
    assert isinstance(mcq, Mcq)
    assert mcq.question == (Text("What is 2+2?"),)
    assert len(mcq.options) == 3
    assert mcq.options[0].correct is False
    assert mcq.options[1].correct is False
    assert mcq.options[2].correct is True
    assert mcq.multi is False


def test_mcq_multi_correct() -> None:
    src = "Which tenses are correct?\n- [x] has lived\n- [x] have lived\n- [ ] is living\n"
    doc, _ = parse_markdown(src)
    mcq = doc.blocks[0]
    assert isinstance(mcq, Mcq)
    assert mcq.multi is True
    assert mcq.options[0].correct is True
    assert mcq.options[1].correct is True
    assert mcq.options[2].correct is False


def test_plain_list_not_mcq() -> None:
    doc, _ = parse_markdown("Context.\n\n- item one\n- item two\n")
    assert len(doc.blocks) == 2
    assert isinstance(doc.blocks[0], Paragraph)
    assert isinstance(doc.blocks[1], BulletList)


def test_lone_checkbox_stays_bullet() -> None:
    doc, _ = parse_markdown("Just one tick:\n\n- [x] only\n")
    bl = doc.blocks[1]
    assert isinstance(bl, BulletList)


def test_sized_checkbox_not_mcq() -> None:
    doc, _ = parse_markdown("Question?\n\n- [x]{size=14} text\n")
    bl = doc.blocks[1]
    assert isinstance(bl, BulletList)


# --- teacher notes ----------------------------------------------------------


def test_teacher_note() -> None:
    src = '::: teacher {tag="Notes"}\nSome note text.\n:::\n'
    doc, _ = parse_markdown(src)
    assert len(doc.blocks) == 1
    note = doc.blocks[0]
    assert isinstance(note, TeacherNote)
    assert note.tag == "Notes"


def test_unclosed_note_warns() -> None:
    src = '::: teacher {tag="Notes"}\nSome note text.\n'
    doc, warnings = parse_markdown(src)
    assert isinstance(doc.blocks[0], TeacherNote)
    assert len(warnings) > 0


def test_note_after_paragraph_and_list() -> None:
    src = (
        "A paragraph.\n"
        "\n"
        "- item one\n"
        "- item two\n"
        "\n"
        '::: teacher {tag="Notes"}\n'
        "Note content.\n"
        ":::\n"
    )
    doc, _ = parse_markdown(src)
    assert len(doc.blocks) == 3
    assert isinstance(doc.blocks[0], Paragraph)
    assert isinstance(doc.blocks[1], BulletList)
    assert isinstance(doc.blocks[2], TeacherNote)


# --- split points -----------------------------------------------------------


def test_split_point() -> None:
    src = "Read this.\n\n<!-- split: Homework starts here -->\n\nWrite a paragraph.\n"
    doc, _ = parse_markdown(src)
    splits = [b for b in doc.blocks if isinstance(b, SplitPoint)]
    assert len(splits) == 1
    assert splits[0].label == "Homework starts here"


def test_second_split_point_becomes_raw() -> None:
    src = "<!-- split: A -->\ncontent\n<!-- split: B -->\nmore\n"
    doc, warnings = parse_markdown(src)
    assert isinstance(doc.blocks[0], SplitPoint)
    assert isinstance(doc.blocks[2], RawBlock)
    assert any("Only one split point" in w for w in warnings)


# --- unknown blocks ---------------------------------------------------------


def test_unknown_block() -> None:
    doc, warnings = parse_markdown("::: foo\ncontent\n:::\n")
    assert isinstance(doc.blocks[0], RawBlock)
    assert any("1 unsupported block(s) kept as written" in w for w in warnings)


# --- front matter -----------------------------------------------------------


def test_front_matter_valid() -> None:
    src = "---\ntitle: Test\ndoc_type: grammar\n---\nBody text.\n"
    doc, _ = parse_markdown(src)
    assert doc.meta.data is not None
    assert doc.meta.data["title"] == "Test"
    assert "title" in doc.meta.raw
    assert len(doc.blocks) == 1
    assert isinstance(doc.blocks[0], Paragraph)


def test_front_matter_broken() -> None:
    src = "---\n: : [\n---\nbody\n"
    doc, _ = parse_markdown(src)
    assert doc.meta.broken is True
    assert len(doc.blocks) == 1
    assert isinstance(doc.blocks[0], Paragraph)


# --- edge cases -------------------------------------------------------------


def test_empty_input() -> None:
    doc, _ = parse_markdown("")
    assert len(doc.blocks) == 1
    assert doc.blocks[0] == Paragraph(content=())


def test_crlf_equals_lf() -> None:
    doc_lf, w_lf = parse_markdown("# Hello\n\nWorld\n")
    doc_crlf, w_crlf = parse_markdown("# Hello\r\n\r\nWorld\r\n")
    assert doc_lf == doc_crlf
    assert w_lf == w_crlf


def test_nested_same_mark_keeps_outer_mark() -> None:
    doc, _ = parse_markdown("**x [y]{.b} z**")
    assert isinstance(doc.blocks[0], Paragraph)
    assert doc.blocks[0].content == (Text(text="x y z", marks=("bold",)),)
