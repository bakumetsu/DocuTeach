"""Markdown parser for DocuTeach."""

from __future__ import annotations

import re
from typing import Final, NamedTuple, cast

from markdown_it import MarkdownIt
from markdown_it.token import Token

from docuteach.md.frontmatter import EMPTY_META, split_front_matter
from docuteach.md.inline import inline_to_nodes
from docuteach.md.model import (
    Block,
    BulletList,
    Doc,
    Heading,
    Inline,
    ListItem,
    Mcq,
    McqOption,
    OrderedList,
    Paragraph,
    RawBlock,
    SplitPoint,
    Table,
    TableCell,
    TeacherNote,
    Text,
)
from docuteach.md.rules_block import comment_plugin, div_plugin, raw_plugin
from docuteach.md.rules_inline import blank_plugin, mark_plugin, span_plugin
from docuteach.md.rules_table import table_plugin

_MCQ_PREFIX_RE: Final = re.compile(r"^\[( |x|X)\]( |$)")
_MCQ_STRIP_RE: Final = re.compile(r"^\[( |x|X)\] ?")


def create_md() -> MarkdownIt:
    md = MarkdownIt("default", {"html": False, "linkify": False, "typographer": False})
    md.disable(
        [
            "strikethrough",
            "link",
            "image",
            "autolink",
            "reference",
            "code",
            "fence",
            "blockquote",
            "hr",
            "html_block",
            "table",
            "backticks",
        ],
        ignoreInvalid=True,
    )
    # lheading sets state.parentType="paragraph" and forgets to restore it
    # on False (unlike the JS original), breaking div_plugin's parentType check.
    from markdown_it.rules_block import StateBlock

    _lh = next(r for r in md.block.ruler.__rules__ if r.name == "lheading")
    _orig_lh = _lh.fn

    def _wrapped_lh(state: StateBlock, start: int, end: int, silent: bool) -> bool:
        old = state.parentType
        result = _orig_lh(state, start, end, silent)
        if not result:
            state.parentType = old
        return result

    _lh.fn = _wrapped_lh
    md.use(blank_plugin)
    md.use(span_plugin)
    md.use(mark_plugin)
    md.use(div_plugin)
    md.use(comment_plugin)
    md.use(raw_plugin)
    md.use(table_plugin)
    return md


_MD: Final = create_md()


class ParseResult(NamedTuple):
    doc: Doc
    warnings: tuple[str, ...]


def _inline_text(content: tuple[Inline, ...]) -> str:
    return "".join(item.text for item in content if isinstance(item, Text))


def _block_text(block: Block) -> str:
    if isinstance(block, (Heading, Paragraph)):
        return _inline_text(block.content)
    if isinstance(block, (BulletList, OrderedList)):
        return "".join(_inline_text(item.content) for item in block.items)
    if isinstance(block, Table):
        return "".join("".join(_inline_text(c.content) for c in row) for row in block.rows)
    if isinstance(block, TeacherNote):
        return "".join(_block_text(b) for b in block.blocks)
    if isinstance(block, Mcq):
        return _inline_text(block.question)
    if isinstance(block, RawBlock):
        return block.text
    return ""


def _meta_str(tok: Token, key: str) -> str | None:
    meta = tok.meta
    val = meta.get(key)
    if isinstance(val, str):
        return val
    return None


def _coerce_to_allowed(block: Block) -> list[Block]:
    if isinstance(block, (Paragraph, BulletList, OrderedList)):
        return [block]
    if isinstance(block, Heading):
        return [Paragraph(block.content)]
    if isinstance(block, Table):
        result: list[Block] = []
        for row in block.rows:
            cell_texts = [_inline_text(cell.content) for cell in row]
            result.append(Paragraph((Text(" | ".join(cell_texts)),)))
        return result
    text = _block_text(block)
    if text:
        return [Paragraph((Text(text),))]
    return [Paragraph(())]


class _BlockBuilder:
    """Builds DocuTeach model blocks from markdown-it-py tokens."""

    def __init__(self, tokens: list[Token], lines: list[str], warnings: list[str]) -> None:
        self._tokens = tokens
        self._lines = lines
        self._warnings = warnings
        self._i = 0
        self._split_seen = False
        self._last_para_end: int | None = None
        self._last_para_index: int | None = None
        self._last_para_inline: list[Token] | None = None

    def build(self) -> list[Block]:
        return self._parse_seq(None, "doc")

    def _parse_seq(self, stop: str | None, mode: str) -> list[Block]:
        result: list[Block] = []
        tokens = self._tokens
        while self._i < len(tokens) and (stop is None or tokens[self._i].type != stop):
            tok = tokens[self._i]
            t = tok.type
            if t == "heading_open":
                result.append(self._parse_heading())
            elif t == "paragraph_open":
                self._parse_paragraph(mode, result)
            elif t in ("bullet_list_open", "ordered_list_open"):
                result.append(self._parse_list(mode, result))
            elif t == "table_open":
                result.append(self._parse_table())
            elif t == "teacher_open":
                result.append(self._parse_teacher(tok))
            elif t == "align_open":
                result.extend(self._parse_align(tok, mode))
            elif t == "raw_block":
                result.append(RawBlock(tok.content))
                self._i += 1
            elif t == "split_point":
                result.append(self._parse_split(tok))
            else:
                self._i += 1
        return result

    def _parse_heading(self) -> Heading:
        tok = self._tokens[self._i]
        level = int(tok.tag[1:])
        self._i += 1  # past heading_open
        inline_tok = self._tokens[self._i]
        self._i += 1  # past inline
        self._i += 1  # past heading_close
        content = inline_to_nodes(inline_tok.children or [], warnings=self._warnings)
        return Heading(level, content, "left")

    def _parse_paragraph(self, mode: str, result: list[Block]) -> None:
        tok = self._tokens[self._i]
        self._i += 1  # past paragraph_open
        inline_tok = self._tokens[self._i]
        self._i += 1  # past inline
        self._i += 1  # past paragraph_close
        content = inline_to_nodes(inline_tok.children or [], warnings=self._warnings)
        result.append(Paragraph(content, "left"))
        if mode == "doc":
            self._last_para_end = tok.map[1] if tok.map is not None else None
            self._last_para_index = len(result) - 1
            self._last_para_inline = inline_tok.children

    def _parse_list(self, mode: str, result: list[Block]) -> Block:
        list_tok = self._tokens[self._i]
        is_bullet = list_tok.type == "bullet_list_open"
        self._i += 1  # past list_open

        # MCQ check (doc mode, bullet lists, >= 2 items)
        if mode == "doc" and is_bullet:
            mcq_result = self._scan_mcq()
            if mcq_result is not None:
                opts, end_i = mcq_result
                multi = sum(1 for _, correct in opts if correct) > 1
                q_children: list[Token] | None = None
                list_start = list_tok.map[0] if list_tok.map is not None else -1
                if self._last_para_index is not None and self._last_para_end == list_start:
                    q_children = self._last_para_inline
                    result.pop()
                    self._last_para_index = None
                    self._last_para_end = None
                    self._last_para_inline = None
                question = inline_to_nodes(q_children or [], warnings=self._warnings)
                option_nodes: list[McqOption] = []
                for children, correct in opts:
                    for c in children:
                        if c.type == "text" and _MCQ_PREFIX_RE.match(c.content):
                            c.content = _MCQ_STRIP_RE.sub("", c.content)
                    option_nodes.append(
                        McqOption(inline_to_nodes(children, warnings=self._warnings), correct)
                    )
                self._i = end_i + 1  # past list_close
                return Mcq(question, tuple(option_nodes), multi)

        # Normal list
        item_nodes: list[ListItem] = []
        tokens = self._tokens
        while self._i < len(tokens) and tokens[self._i].type == "list_item_open":
            self._i += 1  # past list_item_open
            children = self._parse_seq("list_item_close", "item")
            self._i += 1  # past list_item_close

            para: Paragraph | None = None
            nested: list[BulletList | OrderedList] = []
            for child in children:
                if isinstance(child, Paragraph) and para is None:
                    para = child
                elif isinstance(child, (BulletList, OrderedList)):
                    nested.append(child)
                else:
                    txt = _block_text(child)
                    if para is None:
                        para = Paragraph((Text(txt),))
                    else:
                        existing = _inline_text(para.content)
                        para = Paragraph((Text(existing + " " + txt),), para.align)
            if para is None:
                para = Paragraph(())
            item_nodes.append(ListItem(para.content, tuple(nested)))
        self._i += 1  # past list_close

        items = tuple(item_nodes)
        if is_bullet:
            return BulletList(items)
        return OrderedList(items)

    def _scan_mcq(self) -> tuple[list[tuple[list[Token], bool]], int] | None:
        scan_i = self._i
        tokens = self._tokens
        opts: list[tuple[list[Token], bool]] = []
        while scan_i < len(tokens) and tokens[scan_i].type == "list_item_open":
            scan_i += 1  # past list_item_open
            item_tokens: list[Token] = []
            while scan_i < len(tokens) and tokens[scan_i].type != "list_item_close":
                item_tokens.append(tokens[scan_i])
                scan_i += 1
            scan_i += 1  # past list_item_close

            para_opens = [t for t in item_tokens if t.type == "paragraph_open"]
            has_nested = any(
                t.type in ("bullet_list_open", "ordered_list_open") for t in item_tokens
            )
            if len(para_opens) != 1 or has_nested:
                return None
            if not para_opens[0].hidden:
                return None
            inline_tok: Token | None = None
            for t in item_tokens:
                if t.type == "inline":
                    inline_tok = t
                    break
            if inline_tok is None or not inline_tok.children:
                return None
            m = _MCQ_PREFIX_RE.match(inline_tok.content)
            if m is None:
                return None
            opts.append((inline_tok.children, m.group(1) != " "))
        if len(opts) >= 2:
            return (opts, scan_i)
        return None

    def _parse_table(self) -> Table:
        table_open_tok = self._tokens[self._i]
        aligns_raw: list[str | None] = (
            table_open_tok.meta.get("aligns", []) if table_open_tok.meta else []
        )
        self._i += 1  # past table_open
        tokens = self._tokens
        rows: list[tuple[TableCell, ...]] = []
        while self._i < len(tokens) and tokens[self._i].type != "table_close":
            if tokens[self._i].type == "tr_open":
                self._i += 1  # past tr_open
                cells: list[TableCell] = []
                while self._i < len(tokens) and tokens[self._i].type != "tr_close":
                    cell_tok = tokens[self._i]
                    is_header = cell_tok.type == "th_open"
                    self._i += 1  # past th_open/td_open
                    inline_tok = tokens[self._i]
                    self._i += 1  # past inline
                    self._i += 1  # past th_close/td_close
                    content = inline_to_nodes(inline_tok.children or [], warnings=self._warnings)
                    cells.append(TableCell(content, is_header))
                self._i += 1  # past tr_close
                rows.append(tuple(cells))
            else:
                self._i += 1  # skip thead_open, thead_close, tbody_open, tbody_close
        self._i += 1  # past table_close
        aligns = tuple(aligns_raw) if any(a is not None for a in aligns_raw) else ()
        return Table(tuple(rows), aligns)

    def _parse_teacher(self, open_tok: Token) -> TeacherNote:
        tag = _meta_str(open_tok, "tag")
        unlocked = bool((open_tok.meta or {}).get("unlocked"))
        self._i += 1  # past teacher_open
        children = self._parse_seq("teacher_close", "note")
        self._i += 1  # past teacher_close
        coerced: list[Block] = []
        for child in children:
            coerced.extend(_coerce_to_allowed(child))
        blocks: tuple[Block, ...] = tuple(coerced) if coerced else (Paragraph(()),)
        return TeacherNote(tag, blocks, unlocked)

    def _parse_align(self, open_tok: Token, mode: str) -> list[Block]:
        align = _meta_str(open_tok, "align")
        self._i += 1  # past align_open
        children = self._parse_seq("align_close", mode)
        self._i += 1  # past align_close
        if mode == "doc" and align is not None:
            result: list[Block] = []
            for child in children:
                if isinstance(child, Paragraph):
                    result.append(Paragraph(child.content, align))
                elif isinstance(child, Heading):
                    result.append(Heading(child.level, child.content, align))
                else:
                    result.append(child)
            return result
        return children

    def _parse_split(self, tok: Token) -> Block:
        label = _meta_str(tok, "label")
        self._i += 1
        if not self._split_seen:
            self._split_seen = True
            return SplitPoint(label or "Homework starts here")
        start = tok.map[0] if tok.map is not None else 0
        end = tok.map[1] if tok.map is not None else start
        text = "\n".join(self._lines[start:end])
        self._warnings.append(
            "Only one split point is allowed; the extra one was kept as an unsupported block"
        )
        return RawBlock(text)


def parse_markdown(text: str) -> ParseResult:
    try:
        src = text
        if src and src[0] == "\ufeff":
            src = src[1:]
        src = src.replace("\r\n", "\n").replace("\r", "\n")

        fm = split_front_matter(src)
        warnings: list[str] = []
        if fm.warning is not None:
            warnings.append(fm.warning)

        env: dict[str, object] = {"warnings": []}
        tokens = _MD.parse(fm.body, env)
        lines = fm.body.split("\n")

        env_warnings = env["warnings"]
        if isinstance(env_warnings, list):
            warnings.extend([str(w) for w in cast("list[object]", env_warnings)])

        builder = _BlockBuilder(tokens, lines, warnings)
        blocks = builder.build()

        # Count RawBlock at top level
        raw_count = sum(1 for b in blocks if isinstance(b, RawBlock))
        if raw_count > 0:
            warnings.append(f"{raw_count} unsupported block(s) kept as written")

        final_blocks: tuple[Block, ...] = tuple(blocks) if blocks else (Paragraph(()),)
        doc = Doc(fm.meta, final_blocks)
        return ParseResult(doc, tuple(warnings))
    except Exception as e:
        doc = Doc(EMPTY_META, (Paragraph((Text(text),)),))
        return ParseResult(doc, (f"Parse error: {e}",))
