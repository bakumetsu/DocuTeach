"""Teacher DOCX renderer."""
# python-docx's XML layer is untyped, so these rules are off for this module only.
# pyright: reportUnknownMemberType=false, reportUnknownVariableType=false, reportPrivateUsage=false, reportUnknownArgumentType=false
from __future__ import annotations

import io
from dataclasses import dataclass
from typing import TYPE_CHECKING, cast

from docx import Document
from docx.blkcntnr import BlockItemContainer
from docx.document import Document as DocumentObject
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Cm, Emu
from docx.styles.style import ParagraphStyle

from docuteach.export.answer_key import AnswerKey, build_answer_key
from docuteach.export.docx_inline import RunWriter
from docuteach.export.docx_xml import (
    bottom_border,
    cell_borders,
    cell_shade,
    hanging,
    hex_color,
    paragraph_shade,
    row_cant_split,
    row_header,
    set_rfonts,
    set_size,
    style_run,
)
from docuteach.export.table_layout import column_weights
from docuteach.export.typst_inline import PageStyle
from docuteach.md.model import (
    Blank,
    Block,
    BulletList,
    Doc,
    Heading,
    Inline,
    Mcq,
    McqOption,
    OrderedList,
    Paragraph,
    RawBlock,
    SplitPoint,
    Table,
    TeacherNote,
    Text,
)
from docuteach.md.numbering import number_questions

if TYPE_CHECKING:
    pass

_ALIGN_MAP: dict[str, WD_ALIGN_PARAGRAPH] = {
    "left": WD_ALIGN_PARAGRAPH.LEFT,
    "center": WD_ALIGN_PARAGRAPH.CENTER,
    "right": WD_ALIGN_PARAGRAPH.RIGHT,
    "justify": WD_ALIGN_PARAGRAPH.JUSTIFY,
}

_HEADING_SCALE: dict[int, float] = {1: 1.6, 2: 1.3, 3: 1.15}


@dataclass(frozen=True)
class DocxResult:
    data: bytes
    warnings: tuple[str, ...]


def render_docx(doc: Doc, page: PageStyle) -> DocxResult:
    document = Document()
    section = document.sections[0]
    section.page_width = Cm(21)
    section.page_height = Cm(29.7)
    top, right, bottom, left = page.margins_mm
    section.top_margin = Cm(top / 10)
    section.right_margin = Cm(right / 10)
    section.bottom_margin = Cm(bottom / 10)
    section.left_margin = Cm(left / 10)

    normal = cast(ParagraphStyle, document.styles["Normal"])
    rpr = normal.element.get_or_add_rPr()
    set_rfonts(rpr, page.font)
    set_size(rpr, page.size)
    normal.paragraph_format.line_spacing = page.line

    writer = RunWriter(page)
    builder = _Builder(document, writer, page, doc)
    builder.render(doc.blocks, document._body)

    key = build_answer_key(doc)
    builder.render_answer_key(key)

    warnings: list[str] = list(key.warnings)
    if writer.bundled_used:
        warnings.append(
            "fonts_not_embedded: These fonts are not embedded; install them "
            "from Help > Install fonts so Word shows them: "
            + ", ".join(sorted(writer.bundled_used))
        )
    for name in writer.unlisted:
        warnings.append(f"unlisted_font: {name}")

    buf = io.BytesIO()
    document.save(buf)
    return DocxResult(data=buf.getvalue(), warnings=tuple(warnings))


class _Builder:
    def __init__(self, doc: DocumentObject, writer: RunWriter, page: PageStyle, model: Doc) -> None:
        self._doc = doc
        self._writer = writer
        self._page = page
        self._text_width = Cm(21 - (page.margins_mm[1] + page.margins_mm[3]) / 10)
        self._labels: dict[tuple[int, int | None], str] = {}
        for qn in number_questions(model):
            self._labels[(qn.index, qn.item)] = qn.label

    def _add_table(self, container: BlockItemContainer, rows: int, cols: int):
        return container.add_table(rows, cols, self._text_width)

    def render(self, blocks: tuple[Block, ...], container: BlockItemContainer) -> None:
        for i, block in enumerate(blocks):
            self._dispatch(block, container, i)

    def _dispatch(
        self, block: Block, container: BlockItemContainer, block_index: int | None = None
    ) -> None:
        if isinstance(block, Heading):
            self._heading(block, container)
        elif isinstance(block, Paragraph):
            self._para(block, container, block_index)
        elif isinstance(block, OrderedList):
            self._ordered_list(block, container, 0, block_index)
        elif isinstance(block, BulletList):
            self._bullet_list(block, container, 0)
        elif isinstance(block, Mcq):
            self._mcq(block, container, block_index)
        elif isinstance(block, TeacherNote):
            self._teacher_note(block, container)
        elif isinstance(block, Table):
            self._table(block, container)
        elif isinstance(block, SplitPoint):
            self._split_point(block, container)
        else:
            self._raw_block(block, container)

    def _heading(self, block: Heading, container: BlockItemContainer) -> None:
        p = container.add_paragraph()
        p.alignment = _ALIGN_MAP.get(block.align, WD_ALIGN_PARAGRAPH.LEFT)
        scale = _HEADING_SCALE.get(block.level, 1.0)
        self._writer.add(p, block.content, size=self._page.size * scale, bold=True)

    def _para(
        self, block: Paragraph, container: BlockItemContainer, block_index: int | None = None
    ) -> None:
        p = container.add_paragraph()
        p.alignment = _ALIGN_MAP.get(block.align, WD_ALIGN_PARAGRAPH.LEFT)
        label = self._labels.get((block_index, None)) if block_index is not None else None
        if label is not None:
            hanging(p, 0.9, 0.9)
            p.add_run(f"{label}.\t").bold = True
        self._writer.add(p, block.content)

    def _ordered_list(
        self,
        block: OrderedList,
        container: BlockItemContainer,
        depth: int,
        block_index: int | None,
    ) -> None:
        for j, item in enumerate(block.items):
            p = container.add_paragraph()
            hanging(p, 0.9 * (depth + 1), 0.9)
            label = self._labels.get((block_index, j)) if block_index is not None else None
            if label is not None:
                label = f"{label}."
            elif depth > 0:
                label = f"{chr(ord('a') + j)}."
            else:
                label = f"{j + 1}."
            run = p.add_run(f"{label}\t")
            run.bold = True
            self._writer.add(p, item.content)
            self._nested(item.nested, container, depth + 1)

    def _bullet_list(
        self, block: BulletList, container: BlockItemContainer, depth: int
    ) -> None:
        for item in block.items:
            p = container.add_paragraph()
            hanging(p, 0.9 * (depth + 1), 0.9)
            p.add_run("•\t")
            self._writer.add(p, item.content)
            self._nested(item.nested, container, depth + 1)

    def _nested(
        self,
        nested: tuple[BulletList | OrderedList, ...],
        container: BlockItemContainer,
        depth: int,
    ) -> None:
        for n in nested:
            if isinstance(n, OrderedList):
                self._ordered_list(n, container, depth, None)
            else:
                self._bullet_list(n, container, depth)

    def _mcq(
        self, block: Mcq, container: BlockItemContainer, block_index: int | None
    ) -> None:
        p = container.add_paragraph()
        label = self._labels.get((block_index, None)) if block_index is not None else None
        run = p.add_run(f"{label}.\t" if label is not None else "")
        run.bold = True
        self._writer.add(p, block.question)
        if block.multi:
            mrun = p.add_run(" (choose all that apply)")
            mrun.font.color.rgb = hex_color("6B7280")
        for i, opt in enumerate(block.options):
            self._mcq_option(opt, container, i)

    def _mcq_option(
        self, opt: McqOption, container: BlockItemContainer, i: int
    ) -> None:
        p = container.add_paragraph()
        hanging(p, 1.8, 0.9)
        p.add_run(f"{chr(ord('a') + i)}.\t")
        self._writer.add(p, opt.content)
        if opt.correct:
            paragraph_shade(p, "D1FAE5")
            cmark = p.add_run(" ✓")
            cmark.bold = True
            cmark.font.color.rgb = hex_color("15803D")

    def _teacher_note(self, block: TeacherNote, container: BlockItemContainer) -> None:
        table = self._add_table(container, 1, 1)
        cell = table.cell(0, 0)
        cell_borders(cell, "F59E0B")
        cell_shade(cell, "FEF3C7")
        p = cell.paragraphs[0]
        run = p.add_run(f"Teacher note · {block.tag}" if block.tag else "Teacher note")
        run.bold = True
        for sub in block.blocks:
            self._dispatch(sub, cell, None)
        container.add_paragraph()

    def _inline_width_length(self, inline: Inline) -> int:
        if isinstance(inline, Text):
            return len(inline.text)
        if isinstance(inline, Blank):
            return max((len(a) for a in inline.answers), default=10)
        return 0

    def _table(self, block: Table, container: BlockItemContainer) -> None:
        if not block.rows:
            return
        rows = len(block.rows)
        cols = max((len(r) for r in block.rows), default=0)
        if cols == 0:
            return
        lengths: list[list[int]] = []
        for row in block.rows:
            row_lengths: list[int] = []
            for j in range(cols):
                if j < len(row):
                    row_lengths.append(sum(self._inline_width_length(x) for x in row[j].content))
                else:
                    row_lengths.append(0)
            lengths.append(row_lengths)
        weights = column_weights(lengths, cols)
        table = self._add_table(container, rows, cols)
        table.style = "Table Grid"
        table.autofit = False
        total_width = int(self._text_width)
        total_weight = sum(weights)
        for j, weight in enumerate(weights):
            col_width = Emu(total_width * weight // total_weight)
            table.columns[j].width = col_width
            for cell in table.columns[j].cells:
                cell.width = col_width
        for i, row in enumerate(block.rows):
            docx_row = table.rows[i]
            row_cant_split(docx_row)
            if i == 0 and all(cell.header for cell in row):
                row_header(docx_row)
                for cell in docx_row.cells:
                    cell_shade(cell, "F3F4F6")
            for j in range(cols):
                cell = table.cell(i, j)
                cell_borders(cell, "969696")
                align = block.aligns[j] if j < len(block.aligns) else None
                cell.paragraphs[0].alignment = _ALIGN_MAP.get(align or "", WD_ALIGN_PARAGRAPH.LEFT)
                if j < len(row):
                    self._writer.add(
                        cell.paragraphs[0], row[j].content, bold=row[j].header
                    )

    def _split_point(self, block: SplitPoint, container: BlockItemContainer) -> None:
        p = container.add_paragraph()
        bottom_border(p, "9CA3AF")
        run = p.add_run(f"✂ {block.label or 'Split point'}")
        run.font.color.rgb = hex_color("6B7280")
        style_run(run, None, 9)

    def _raw_block(self, block: RawBlock, container: BlockItemContainer) -> None:
        p1 = container.add_paragraph()
        r1 = p1.add_run("Unsupported block (kept as written)")
        r1.font.color.rgb = hex_color("6B7280")
        p2 = container.add_paragraph()
        r2 = p2.add_run(block.text)
        style_run(r2, "Consolas", None)

    def render_answer_key(self, key: AnswerKey) -> None:
        self._doc.add_page_break()
        p = self._doc.add_paragraph()
        run = p.add_run("Answer key")
        run.bold = True
        style_run(run, None, self._page.size * 1.6)

        for section in key.sections:
            if section.heading is not None:
                hp = self._doc.add_paragraph()
                hrun = hp.add_run(section.heading)
                hrun.bold = True
            for line in section.lines:
                lp = self._doc.add_paragraph()
                hanging(lp, 1.2, 1.2)
                lrun = lp.add_run(line.label)
                lrun.bold = True
                lp.add_run(f"  {line.text}")

        if key.other:
            op = self._doc.add_paragraph()
            orun = op.add_run("Other blanks")
            orun.bold = True
            for entry in key.other:
                self._doc.add_paragraph().add_run(entry)

        if not key.sections and not key.other:
            gp = self._doc.add_paragraph()
            grun = gp.add_run("No answers in this document.")
            grun.font.color.rgb = hex_color("6B7280")
