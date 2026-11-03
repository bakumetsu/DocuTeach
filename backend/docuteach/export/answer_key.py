"""Teacher answer key built from the parsed model."""

from __future__ import annotations

from dataclasses import dataclass

from docuteach.md.model import (
    Blank,
    BulletList,
    Doc,
    Heading,
    ListItem,
    Mcq,
    OrderedList,
    Paragraph,
    Table,
    Text,
)
from docuteach.md.numbering import number_questions


@dataclass(frozen=True)
class KeyLine:
    label: str
    text: str


@dataclass(frozen=True)
class KeySection:
    heading: str | None
    lines: tuple[KeyLine, ...]


@dataclass(frozen=True)
class AnswerKey:
    sections: tuple[KeySection, ...]
    other: tuple[str, ...]
    warnings: tuple[str, ...]


def blank_text(b: Blank) -> str:
    if not b.answers or b.answers[0].strip() == "":
        return "(empty)"
    result = b.answers[0]
    for alt in b.answers[1:]:
        result += f" / {alt}"
    return result


def _collect_blanks_item(item: ListItem) -> list[Blank]:
    blanks: list[Blank] = []
    for inline in item.content:
        if isinstance(inline, Blank):
            blanks.append(inline)
    for nested in item.nested:
        for sub in nested.items:
            blanks.extend(_collect_blanks_item(sub))
    return blanks


def _heading_text(h: Heading) -> str:
    return "".join(inline.text for inline in h.content if isinstance(inline, Text))


def _collect_other_items(items: tuple[ListItem, ...], out: list[str]) -> None:
    for item in items:
        for inline in item.content:
            if isinstance(inline, Blank):
                out.append(blank_text(inline))
        for nested in item.nested:
            _collect_other_items(nested.items, out)


def build_answer_key(doc: Doc) -> AnswerKey:
    questions = number_questions(doc)

    level2: list[Heading] = [
        b for b in doc.blocks if isinstance(b, Heading) and b.level == 2
    ]

    section_lines: dict[int, list[KeyLine]] = {}
    warnings_set: set[str] = set()
    warnings_list: list[str] = []

    def _add_warning(w: str) -> None:
        if w not in warnings_set:
            warnings_set.add(w)
            warnings_list.append(w)

    for qn in questions:
        block = doc.blocks[qn.index]
        if isinstance(block, OrderedList) and qn.item is not None:
            item = block.items[qn.item]
            blanks = _collect_blanks_item(item)
            if not blanks:
                continue
            text = "; ".join(blank_text(b) for b in blanks)
            section_lines.setdefault(qn.section, []).append(KeyLine(qn.label, text))
            for b in blanks:
                if blank_text(b) == "(empty)":
                    _add_warning(f"empty_answer: question {qn.label} has an empty blank")
        elif isinstance(block, Mcq):
            correct = [chr(ord("a") + i) for i, opt in enumerate(block.options) if opt.correct]
            if not correct:
                text = "(no correct answer marked)"
                _add_warning(
                    f"mcq_no_answer: question {qn.label} has no correct option marked"
                )
            else:
                text = ", ".join(correct)
            section_lines.setdefault(qn.section, []).append(KeyLine(qn.label, text))

    other: list[str] = []
    for block in doc.blocks:
        if isinstance(block, (Paragraph, Heading)):
            for inline in block.content:
                if isinstance(inline, Blank):
                    other.append(blank_text(inline))
        elif isinstance(block, BulletList):
            _collect_other_items(block.items, other)
        elif isinstance(block, Table):
            for row in block.rows:
                for cell in row:
                    for inline in cell.content:
                        if isinstance(inline, Blank):
                            other.append(blank_text(inline))

    for bt in other:
        if bt == "(empty)":
            _add_warning(
                "empty_answer: a blank outside the numbered questions has no answer"
            )

    sections: list[KeySection] = []
    for sec_num in sorted(section_lines):
        if sec_num == 0:
            heading: str | None = None
        else:
            idx = sec_num - 1
            if idx < len(level2):
                heading = _heading_text(level2[idx])
            else:
                heading = None
        sections.append(KeySection(heading, tuple(section_lines[sec_num])))

    return AnswerKey(tuple(sections), tuple(other), tuple(warnings_list))
