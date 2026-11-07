"""Render a StudentDoc to Typst source and compile to PDF."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory

from docuteach.errors import ApiError
from docuteach.export.fonts import FONTS_DIR, resolve_font, typst_font_arg
from docuteach.export.table_layout import column_weights
from docuteach.export.typst_inline import InlineWriter, PageStyle, typst_string
from docuteach.md.numbering import number_blocks
from docuteach.md.project import (
    StudentBlank,
    StudentBlock,
    StudentBulletList,
    StudentDoc,
    StudentHeading,
    StudentInline,
    StudentListItem,
    StudentMcq,
    StudentOrderedList,
    StudentParagraph,
    StudentSplitPoint,
    StudentTable,
    StudentText,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _fmt(x: float) -> str:
    """Format a number without a trailing .0."""
    if x == int(x):
        return str(int(x))
    return str(x)


def _heading_size(level: int) -> str:
    if level == 1:
        return "1.6"
    if level == 2:
        return "1.3"
    if level == 3:
        return "1.15"
    return "1"


def _heading_align(align: str) -> str:
    if align in ("left", "center", "right"):
        return align
    return "left"


def _inline_visible(content: tuple[StudentInline, ...]) -> bool:
    for item in content:
        if isinstance(item, StudentText) and item.text.strip():
            return True
        if isinstance(item, StudentBlank):
            return True
    return False


def _list_item_visible(item: StudentListItem) -> bool:
    if _inline_visible(item.content):
        return True
    for nested in item.nested:
        if isinstance(nested, StudentBulletList):
            if any(_list_item_visible(i) for i in nested.items):
                return True
        else:
            if any(_list_item_visible(i) for i in nested.items):
                return True
    return False


def _block_visible(block: StudentBlock) -> bool:
    if isinstance(block, StudentHeading):
        return _inline_visible(block.content)
    if isinstance(block, StudentParagraph):
        return _inline_visible(block.content)
    if isinstance(block, StudentBulletList):
        return any(_list_item_visible(i) for i in block.items)
    if isinstance(block, StudentOrderedList):
        return any(_list_item_visible(i) for i in block.items)
    if isinstance(block, StudentTable):
        return any(any(_inline_visible(c.content) for c in row) for row in block.rows)
    if isinstance(block, StudentMcq):
        if _inline_visible(block.question):
            return True
        return any(_inline_visible(o.content) for o in block.options)
    return False  # StudentSplitPoint


# ---------------------------------------------------------------------------
# Label assignment
# ---------------------------------------------------------------------------


def student_labels(doc: StudentDoc) -> dict[int, tuple[str, ...]]:
    """Map block index to tuple of question labels."""
    kinds: list[tuple[str, bool, int]] = []
    for block in doc.blocks:
        if isinstance(block, StudentHeading) and block.level == 2:
            kinds.append(("h2", False, 0))
        elif isinstance(block, StudentMcq):
            kinds.append(("mcq", False, 0))
        elif isinstance(block, StudentOrderedList):
            has_blank = any(
                any(isinstance(x, StudentBlank) for x in item.content)
                for item in block.items
            )
            kinds.append(("olist", has_blank, len(block.items)))
        elif isinstance(block, StudentParagraph):
            has_blank = any(isinstance(x, StudentBlank) for x in block.content)
            kinds.append(("para", has_blank, 0))
        else:
            kinds.append(("other", False, 0))
    results = number_blocks(kinds)
    grouped: dict[int, list[str]] = {}
    for qn in results:
        grouped.setdefault(qn.index, []).append(qn.label)
    return {idx: tuple(lbls) for idx, lbls in grouped.items()}


# ---------------------------------------------------------------------------
# Block renderers
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class RenderResult:
    source: str
    warnings: tuple[str, ...]


def _render_heading(writer: InlineWriter, block: StudentHeading) -> str:
    inline = writer.emit(block.content)
    size = _heading_size(block.level)
    align = _heading_align(block.align)
    return (
        f'#block(above: 1em, below: 0.5em)'
        f'[#align({align})[#text(size: {size}em, weight: "bold")[{inline}]]]'
    )


def _render_paragraph(
    writer: InlineWriter,
    block: StudentParagraph,
    label: str | None = None,
) -> str:
    inline = writer.emit(block.content)
    if label is not None:
        label_cell = f"[#{typst_string(label + '.')}"
        align = _heading_align(block.align)
        if align != "left":
            content_cell = f"[#align({align})[{inline}]]"
        else:
            content_cell = f"[{inline}]"
        return (
            f"#grid(columns: (2.4em, 1fr), column-gutter: 0.3em, "
            f"row-gutter: 0.6em, {label_cell}], {content_cell})"
        )
    if block.align == "justify":
        return f"#par(justify: true)[{inline}]"
    align = _heading_align(block.align)
    return f"#align({align})[{inline}]"


def _render_nested(writer: InlineWriter, item: StudentListItem) -> str:
    parts: list[str] = []
    for nested in item.nested:
        if isinstance(nested, StudentBulletList):
            parts.append("\n" + _render_bullet_list(writer, nested))
        else:
            gen_labels = tuple(str(j + 1) for j in range(len(nested.items)))
            parts.append("\n" + _render_ordered_list(writer, nested, gen_labels))
    return "".join(parts)


def _render_bullet_list(writer: InlineWriter, blist: StudentBulletList) -> str:
    items: list[str] = []
    for item in blist.items:
        inline = writer.emit(item.content)
        nested = _render_nested(writer, item)
        items.append(f"[{inline}{nested}]")
    return "#list(" + ", ".join(items) + ")"


def _render_ordered_list(
    writer: InlineWriter,
    olist: StudentOrderedList,
    labels: tuple[str, ...],
) -> str:
    parts: list[str] = []
    for idx, item in enumerate(olist.items):
        label = labels[idx] if idx < len(labels) else str(idx + 1)
        label_cell = f"[#{typst_string(label + '.')}"
        inline = writer.emit(item.content)
        nested = _render_nested(writer, item)
        content_cell = f"[{inline}{nested}]"
        parts.append(
            f"#grid(columns: (2.4em, 1fr), column-gutter: 0.3em, "
            f"row-gutter: 0.6em, {label_cell}], {content_cell})"
        )
    return "\n".join(parts)


def _render_table(writer: InlineWriter, block: StudentTable) -> str:
    if not block.rows:
        return "#table(columns: 1)"
    max_cols = max(len(row) for row in block.rows)
    if max_cols == 0:
        return "#table(columns: 1)"
    lengths: list[list[int]] = []
    for row in block.rows:
        row_lengths: list[int] = []
        for j in range(max_cols):
            if j < len(row):
                total = 0
                for item in row[j].content:
                    if isinstance(item, StudentText):
                        total += len(item.text)
                    else:
                        total += 10
                row_lengths.append(total)
            else:
                row_lengths.append(0)
        lengths.append(row_lengths)
    weights = column_weights(lengths, max_cols)
    cols = ", ".join(f"{weight}fr" for weight in weights)
    aligns: list[str] = []
    for j in range(max_cols):
        align = block.aligns[j] if j < len(block.aligns) else None
        aligns.append(align if align in ("left", "center", "right") else "auto")
    args: list[str] = [
        f"columns: ({cols})",
        f"align: ({', '.join(aligns)})",
        "stroke: 0.5pt + luma(150)",
        "inset: 6pt",
    ]
    has_header = all(cell.header for cell in block.rows[0])
    body_rows = block.rows[1:] if has_header else block.rows
    if has_header:
        header_cells: list[str] = []
        for j in range(max_cols):
            if j < len(block.rows[0]):
                inline = writer.emit(block.rows[0][j].content)
                header_cells.append(f"[#strong[{inline}]]")
            else:
                header_cells.append("[]")
        args.append(f"table.header({', '.join(header_cells)})")
    body_cells: list[str] = []
    for row in body_rows:
        for j in range(max_cols):
            if j < len(row):
                cell = row[j]
                inline = writer.emit(cell.content)
                if cell.header:
                    body_cells.append(f"[#strong[{inline}]]")
                else:
                    body_cells.append(f"[{inline}]")
            else:
                body_cells.append("[]")
    args.extend(body_cells)
    return "#table(" + ", ".join(args) + ")"


def _render_mcq(
    writer: InlineWriter,
    block: StudentMcq,
    label: str,
) -> str:
    parts: list[str] = []
    label_cell = f"[#{typst_string(label + '.')}"
    question_inline = writer.emit(block.question)
    parts.append(
        f"#grid(columns: (2.4em, 1fr), column-gutter: 0.3em, "
        f"row-gutter: 0.6em, {label_cell}], [{question_inline}])"
    )
    for opt in block.options:
        opt_inline = writer.emit(opt.content)
        letter_lit = typst_string(opt.letter + ".")
        parts.append(
            f"#pad(left: 2.7em)[#{letter_lit} {opt_inline}]"
        )
    if block.multi:
        parts.append('#pad(left: 2.7em)[#emph[#"(choose all that apply)"]]')
    return "\n".join(parts)


def _render_block(
    writer: InlineWriter,
    block: StudentBlock,
    block_idx: int,
    labels: dict[int, tuple[str, ...]],
) -> str | None:
    if isinstance(block, StudentSplitPoint):
        return None
    if isinstance(block, StudentHeading):
        return _render_heading(writer, block)
    if isinstance(block, StudentParagraph):
        para_labels = labels.get(block_idx, ())
        return _render_paragraph(writer, block, para_labels[0] if para_labels else None)
    if isinstance(block, StudentBulletList):
        return _render_bullet_list(writer, block)
    if isinstance(block, StudentOrderedList):
        block_labels = labels.get(block_idx, ())
        return _render_ordered_list(writer, block, block_labels)
    if isinstance(block, StudentTable):
        return _render_table(writer, block)
    block_labels = labels.get(block_idx, ())
    label = block_labels[0] if block_labels else "1"
    return _render_mcq(writer, block, label)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def render_source(
    doc: StudentDoc,
    page: PageStyle,
    lo: int = 0,
    hi: int | None = None,
) -> RenderResult:
    """Render a slice of the document to Typst source."""
    writer = InlineWriter(page.font)
    all_labels = student_labels(doc)
    slice_blocks = doc.blocks[lo:hi]

    # Header
    t, r, b, left = page.margins_mm
    font_arg = typst_font_arg(resolve_font(None, page.font).stack)
    size = _fmt(page.size)
    leading = _fmt(round(page.line - 1, 3))
    header = (
        f'#set page(paper: "a4", margin: (top: {_fmt(t)}mm, right: {_fmt(r)}mm, '
        f"bottom: {_fmt(b)}mm, left: {_fmt(left)}mm), "
        f'footer: context [#align(center)[#counter(page).display("1 / 1", both: true)]])\n'
        f"#set text(font: {font_arg}, size: {size}pt)\n"
        f"#set par(leading: {leading}em, spacing: 0.9em)"
    )

    # Body
    rendered: list[str] = []
    for offset, block in enumerate(slice_blocks):
        block_idx = lo + offset
        result = _render_block(writer, block, block_idx, all_labels)
        if result is not None:
            rendered.append(result)

    body = "\n\n".join(rendered)
    source = header + "\n\n" + body if body else header

    # Warnings
    warnings: list[str] = list(writer.warnings)
    if not any(_block_visible(b) for b in slice_blocks):
        warnings.append("empty_document: The document has no content to export")

    return RenderResult(source=source, warnings=tuple(warnings))


def compile_pdf(source: str) -> bytes:
    """Compile Typst source to PDF bytes using the typst Python package."""
    import typst

    try:
        with TemporaryDirectory() as tmp:
            return typst.compile(
                source.encode("utf-8"),
                root=Path(tmp),  # pyright: ignore[reportArgumentType]  # typst stub binds Input to bytes
                font_paths=[FONTS_DIR],  # pyright: ignore[reportArgumentType]
            )
    except Exception:
        raise ApiError("export_failed", "The PDF could not be built", 500) from None
