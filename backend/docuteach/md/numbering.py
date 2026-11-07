"""Question numbering for teacher documents."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from docuteach.md.model import Blank, Doc, Heading, Mcq, OrderedList, Paragraph


@dataclass(frozen=True)
class QuestionNumber:
    section: int
    n: int
    label: str
    index: int
    item: int | None = None


def number_blocks(kinds: Sequence[tuple[str, bool, int]]) -> list[QuestionNumber]:
    """Number questions from a sequence of (kind, has_blank, item_count) tuples.

    kind: "h2" | "mcq" | "olist" | "para" | anything else.
    For "olist", has_blank is True if any item has a Blank in its own content.
    """
    results: list[QuestionNumber] = []
    section = 0
    n = 0

    for i, (kind, has_blank, item_count) in enumerate(kinds):
        if kind == "h2":
            section += 1
            n = 0
        elif kind == "mcq":
            n += 1
            results.append(QuestionNumber(section, n, str(n), i, None))
        elif kind == "olist" and has_blank:
            for j in range(item_count):
                n += 1
                results.append(QuestionNumber(section, n, str(n), i, j))
        elif kind == "para" and has_blank:
            n += 1
            results.append(QuestionNumber(section, n, str(n), i, None))

    return results


def number_questions(doc: Doc) -> list[QuestionNumber]:
    """Number top-level questions; level-2 headings start new sections."""
    kinds: list[tuple[str, bool, int]] = []
    for block in doc.blocks:
        if isinstance(block, Heading) and block.level == 2:
            kinds.append(("h2", False, 0))
        elif isinstance(block, Mcq):
            kinds.append(("mcq", False, 0))
        elif isinstance(block, OrderedList):
            has_blank = any(
                any(isinstance(x, Blank) for x in item.content)
                for item in block.items
            )
            kinds.append(("olist", has_blank, len(block.items)))
        elif isinstance(block, Paragraph):
            has_blank = any(isinstance(x, Blank) for x in block.content)
            kinds.append(("para", has_blank, 0))
        else:
            kinds.append(("other", False, 0))
    return number_blocks(kinds)
