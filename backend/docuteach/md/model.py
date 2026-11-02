"""Teacher model mirroring the editor's ProseMirror tree."""

from __future__ import annotations

import dataclasses
from dataclasses import dataclass
from typing import cast


@dataclass(frozen=True)
class Style:
    font: str | None = None
    size: float | None = None


@dataclass(frozen=True)
class Text:
    text: str
    marks: tuple[str, ...] = ()
    style: Style | None = None


@dataclass(frozen=True)
class Blank:
    answers: tuple[str, ...] = ()
    style: Style | None = None


@dataclass(frozen=True)
class Break:
    pass


type Inline = Text | Blank | Break


@dataclass(frozen=True)
class Heading:
    level: int
    content: tuple[Inline, ...]
    align: str = "left"


@dataclass(frozen=True)
class Paragraph:
    content: tuple[Inline, ...]
    align: str = "left"


@dataclass(frozen=True)
class ListItem:
    content: tuple[Inline, ...]
    nested: tuple[BulletList | OrderedList, ...] = ()


@dataclass(frozen=True)
class BulletList:
    items: tuple[ListItem, ...]


@dataclass(frozen=True)
class OrderedList:
    items: tuple[ListItem, ...]


@dataclass(frozen=True)
class TableCell:
    content: tuple[Inline, ...]
    header: bool = False


@dataclass(frozen=True)
class Table:
    rows: tuple[tuple[TableCell, ...], ...]


@dataclass(frozen=True)
class McqOption:
    content: tuple[Inline, ...]
    correct: bool


@dataclass(frozen=True)
class Mcq:
    question: tuple[Inline, ...]
    options: tuple[McqOption, ...]
    multi: bool


@dataclass(frozen=True)
class TeacherNote:
    tag: str | None
    blocks: tuple[Block, ...]


@dataclass(frozen=True)
class SplitPoint:
    label: str


@dataclass(frozen=True)
class RawBlock:
    text: str


type Block = (
    Heading
    | Paragraph
    | BulletList
    | OrderedList
    | Table
    | Mcq
    | TeacherNote
    | SplitPoint
    | RawBlock
)


@dataclass(frozen=True)
class Meta:
    raw: str = ""
    data: dict[str, object] | None = None
    broken: bool = False


@dataclass(frozen=True)
class Doc:
    meta: Meta
    blocks: tuple[Block, ...]


def to_json(node: object) -> object:
    """Convert any model object into plain JSON-able data."""
    if dataclasses.is_dataclass(node) and not isinstance(node, type):
        d: dict[str, object] = {"type": type(node).__name__}
        for f in dataclasses.fields(node):
            d[f.name] = to_json(getattr(node, f.name))
        return d
    if isinstance(node, tuple):
        items = cast("tuple[object, ...]", node)
        return [to_json(x) for x in items]
    return node
