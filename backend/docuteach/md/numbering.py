"""Question numbering for teacher documents."""

from __future__ import annotations

from dataclasses import dataclass

from docuteach.md.model import Doc, Heading, Mcq, OrderedList


@dataclass(frozen=True)
class QuestionNumber:
    section: int
    n: int
    label: str
    index: int
    item: int | None = None


def number_questions(doc: Doc) -> list[QuestionNumber]:
    """Number top-level questions; level-2 headings start new sections."""
    results: list[QuestionNumber] = []
    section = 0
    n = 0

    for i, block in enumerate(doc.blocks):
        if isinstance(block, Heading) and block.level == 2:
            section += 1
            n = 0

        if isinstance(block, OrderedList):
            for j in range(len(block.items)):
                n += 1
                label = str(n) if section == 0 else f"{section}.{n}"
                results.append(QuestionNumber(section, n, label, i, j))
        elif isinstance(block, Mcq):
            n += 1
            label = str(n) if section == 0 else f"{section}.{n}"
            results.append(QuestionNumber(section, n, label, i, None))

    return results
