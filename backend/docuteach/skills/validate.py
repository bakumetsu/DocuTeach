from __future__ import annotations

from docuteach.md.model import (
    Blank,
    Block,
    BulletList,
    ListItem,
    OrderedList,
    Paragraph,
    RawBlock,
    TeacherNote,
)
from docuteach.md.parser import parse_markdown


def _has_raw_block(blocks: tuple[Block, ...]) -> bool:
    for block in blocks:
        if isinstance(block, RawBlock):
            return True
        if isinstance(block, TeacherNote) and _has_raw_block(block.blocks):
            return True
    return False


def _is_empty_paragraph(block: object) -> bool:
    return isinstance(block, Paragraph) and block.content == ()


def _item_has_valid_blank(item: ListItem) -> bool:
    for inline in item.content:
        if isinstance(inline, Blank):
            if any(a.strip() != "" for a in inline.answers):
                return True
    return False


def validate_output(insert_as: str, markdown: str) -> str | None:
    text = markdown.strip()
    if not text:
        return "empty"

    result = parse_markdown(text)

    if result.warnings:
        return "parser_warning"

    meta = result.doc.meta
    if meta.raw != "" or meta.broken:
        return "front_matter"

    if _has_raw_block(result.doc.blocks):
        return "raw_block"

    remaining = [b for b in result.doc.blocks if not _is_empty_paragraph(b)]

    if insert_as == "teacherNote":
        if len(remaining) != 1 or not isinstance(remaining[0], TeacherNote):
            return "not_single_note"
        note = remaining[0]
        if note.tag is None or note.tag == "":
            return "note_no_tag"
        if len(note.blocks) == 0:
            return "note_empty"
        if len(text) > 4000:
            return "note_too_long"
        return None

    if insert_as == "blanks":
        if len(remaining) != 1 or not isinstance(remaining[0], OrderedList):
            return "not_single_list"
        ol = remaining[0]
        if not (3 <= len(ol.items) <= 10):
            return "list_size"
        for item in ol.items:
            if not _item_has_valid_blank(item):
                return "item_no_blank"
        return None

    if insert_as == "text":
        if len(remaining) == 0:
            return "empty"
        for block in remaining:
            if not isinstance(block, (Paragraph, BulletList, OrderedList)):
                return "text_only"
        return None

    return "unknown_kind"
