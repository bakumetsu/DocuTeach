"""Tests for question numbering (port of frontend/test/numbering.test.ts)."""

from __future__ import annotations

import pytest

from docuteach.md.model import (
    BulletList,
    Doc,
    Heading,
    ListItem,
    Mcq,
    McqOption,
    Meta,
    OrderedList,
    Paragraph,
    TeacherNote,
    Text,
)
from docuteach.md.numbering import number_questions


def _doc(*blocks: object) -> Doc:
    return Doc(Meta(), tuple(blocks))  # type: ignore[arg-type]


def _ordered(*texts: str) -> OrderedList:
    return OrderedList(tuple(ListItem((Text(t),)) for t in texts))


def _bullet(*texts: str) -> BulletList:
    return BulletList(tuple(ListItem((Text(t),)) for t in texts))


@pytest.mark.parametrize(
    ("name", "doc", "expected"),
    [
        (
            "a",
            _doc(_ordered("a", "b")),
            ((0, 1, "1"), (0, 2, "2")),
        ),
        (
            "b",
            _doc(
                Heading(2, (Text("A"),)),
                _ordered("a", "b"),
                Heading(2, (Text("B"),)),
                _ordered("c", "d"),
            ),
            ((1, 1, "1.1"), (1, 2, "1.2"), (2, 1, "2.1"), (2, 2, "2.2")),
        ),
        (
            "c",
            _doc(
                _ordered("a"),
                TeacherNote(None, (Paragraph((Text("note"),)),)),
                _ordered("b"),
            ),
            ((0, 1, "1"), (0, 2, "2")),
        ),
        (
            "d",
            _doc(
                _ordered("a"),
                Mcq(
                    (Text("What is 2+2?"),),
                    (McqOption((Text("3"),), False), McqOption((Text("4"),), True)),
                    False,
                ),
                _ordered("b"),
            ),
            ((0, 1, "1"), (0, 2, "2"), (0, 3, "3")),
        ),
        (
            "e",
            _doc(
                _bullet("bullet", "bullet"),
                OrderedList(
                    (
                        ListItem(
                            (Text("a"),),
                            (
                                OrderedList(
                                    (
                                        ListItem((Text("nested"),)),
                                        ListItem((Text("nested"),)),
                                    )
                                ),
                            ),
                        ),
                    )
                ),
            ),
            ((0, 1, "1"),),
        ),
        (
            "f",
            _doc(TeacherNote(None, (_ordered("a", "b"),))),
            (),
        ),
        (
            "g",
            _doc(Heading(1, (Text("Title"),)), _ordered("a", "b")),
            ((0, 1, "1"), (0, 2, "2")),
        ),
        (
            "h",
            _doc(Heading(2, (Text("1. Rule"),)), _ordered("a", "b")),
            ((1, 1, "1.1"), (1, 2, "1.2")),
        ),
    ],
    ids=["a", "b", "c", "d", "e", "f", "g", "h"],
)
def test_numbering(
    name: str,
    doc: Doc,
    expected: tuple[tuple[int, int, str], ...],
) -> None:
    nums = number_questions(doc)
    assert tuple((q.section, q.n, q.label) for q in nums) == expected


def test_index_and_item() -> None:
    """Case (i): verify index (block position) and item (list-item position)."""
    doc = _doc(_ordered("a", "b"))
    nums = number_questions(doc)
    assert len(nums) == 2
    assert nums[0].index == 0
    assert nums[0].item == 0
    assert nums[1].index == 0
    assert nums[1].item == 1
