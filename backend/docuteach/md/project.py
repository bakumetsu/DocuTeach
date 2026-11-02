"""Student projection: strips teacher-only data from a Doc."""

from __future__ import annotations

from dataclasses import dataclass

from docuteach.md.model import (
    Blank,
    Block,
    BulletList,
    Doc,
    Heading,
    Inline,
    ListItem,
    Mcq,
    OrderedList,
    Paragraph,
    SplitPoint,
    Style,
    Table,
    Text,
)


@dataclass(frozen=True)
class StudentText:
    text: str
    marks: tuple[str, ...] = ()
    style: Style | None = None


@dataclass(frozen=True)
class StudentBlank:
    style: Style | None = None


@dataclass(frozen=True)
class StudentBreak:
    pass


type StudentInline = StudentText | StudentBlank | StudentBreak


@dataclass(frozen=True)
class StudentHeading:
    level: int
    content: tuple[StudentInline, ...]
    align: str = "left"


@dataclass(frozen=True)
class StudentParagraph:
    content: tuple[StudentInline, ...]
    align: str = "left"


@dataclass(frozen=True)
class StudentListItem:
    content: tuple[StudentInline, ...]
    nested: tuple[StudentBulletList | StudentOrderedList, ...] = ()


@dataclass(frozen=True)
class StudentBulletList:
    items: tuple[StudentListItem, ...]


@dataclass(frozen=True)
class StudentOrderedList:
    items: tuple[StudentListItem, ...]


@dataclass(frozen=True)
class StudentTableCell:
    content: tuple[StudentInline, ...]
    header: bool = False


@dataclass(frozen=True)
class StudentTable:
    rows: tuple[tuple[StudentTableCell, ...], ...]


@dataclass(frozen=True)
class StudentOption:
    content: tuple[StudentInline, ...]
    letter: str


@dataclass(frozen=True)
class StudentMcq:
    question: tuple[StudentInline, ...]
    options: tuple[StudentOption, ...]
    multi: bool


@dataclass(frozen=True)
class StudentSplitPoint:
    pass


type StudentBlock = (
    StudentHeading
    | StudentParagraph
    | StudentBulletList
    | StudentOrderedList
    | StudentTable
    | StudentMcq
    | StudentSplitPoint
)


@dataclass(frozen=True)
class StudentDoc:
    blocks: tuple[StudentBlock, ...]


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _project_inline(inline: Inline) -> StudentInline:
    match inline:
        case Text(text=t, marks=m, style=s):
            return StudentText(text=t, marks=m, style=s)
        case Blank(style=s):
            return StudentBlank(style=s)
        case _:
            return StudentBreak()


def _project_list_item(item: ListItem) -> StudentListItem:
    content = tuple(_project_inline(i) for i in item.content)
    nested = tuple(_project_list(n) for n in item.nested)
    return StudentListItem(content=content, nested=nested)


def _project_list(
    lst: BulletList | OrderedList,
) -> StudentBulletList | StudentOrderedList:
    items = tuple(_project_list_item(i) for i in lst.items)
    if isinstance(lst, BulletList):
        return StudentBulletList(items=items)
    return StudentOrderedList(items=items)


def _project_block(block: Block) -> StudentBlock | None:
    match block:
        case Heading(level=l, content=c, align=a):
            return StudentHeading(
                level=l,
                content=tuple(_project_inline(i) for i in c),
                align=a,
            )
        case Paragraph(content=c, align=a):
            return StudentParagraph(
                content=tuple(_project_inline(i) for i in c),
                align=a,
            )
        case BulletList(items=items):
            return StudentBulletList(items=tuple(_project_list_item(i) for i in items))
        case OrderedList(items=items):
            return StudentOrderedList(items=tuple(_project_list_item(i) for i in items))
        case Table(rows=rows):
            return StudentTable(
                rows=tuple(
                    tuple(
                        StudentTableCell(
                            content=tuple(_project_inline(i) for i in cell.content),
                            header=cell.header,
                        )
                        for cell in row
                    )
                    for row in rows
                ),
            )
        case Mcq(question=q, options=opts, multi=m):
            correct_count = sum(1 for o in opts if o.correct)
            student_options = tuple(
                StudentOption(
                    content=tuple(_project_inline(i) for i in o.content),
                    letter=chr(ord("a") + idx),
                )
                for idx, o in enumerate(opts)
            )
            return StudentMcq(
                question=tuple(_project_inline(i) for i in q),
                options=student_options,
                multi=m or correct_count > 1,
            )
        case SplitPoint():
            return StudentSplitPoint()
        case _:
            return None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def project_student(doc: Doc) -> StudentDoc:
    """Project a teacher Doc into a student-safe StudentDoc."""
    blocks: list[StudentBlock] = []
    for block in doc.blocks:
        projected = _project_block(block)
        if projected is not None:
            blocks.append(projected)
    if not blocks:
        blocks = [StudentParagraph(content=(), align="left")]
    return StudentDoc(blocks=tuple(blocks))
