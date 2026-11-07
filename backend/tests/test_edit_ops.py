"""Tests for docuteach.edits.ops."""

from __future__ import annotations

from docuteach.edits.ops import EditParser, Item, Reply, parse_ops

# --- 1. Every header form ---------------------------------------------------


def test_replace_single() -> None:
    text = "@@ replace b5 @@\nnew content\n"
    reply, ops, skips = parse_ops(text)
    assert reply == ""
    assert len(ops) == 1 and skips == []
    o = ops[0]
    assert o.kind == "replace"
    assert o.targets == ("b5",)
    assert o.anchor is None
    assert o.side is None
    assert o.markdown == "new content"
    assert o.header == "@@ replace b5 @@"


def test_replace_range_expands() -> None:
    text = "@@ replace b5-b6 @@\ncontent\n"
    _, ops, _ = parse_ops(text)
    assert ops[0].targets == ("b5", "b6")


def test_insert_after() -> None:
    text = "@@ insert after b5 @@\nnew block\n"
    _, ops, _ = parse_ops(text)
    o = ops[0]
    assert o.kind == "insert"
    assert o.targets == ()
    assert o.anchor == "b5"
    assert o.side == "after"
    assert o.markdown == "new block"
    assert o.header == "@@ insert after b5 @@"


def test_insert_before() -> None:
    text = "@@ insert before b3 @@\nstuff\n"
    _, ops, _ = parse_ops(text)
    assert ops[0].side == "before"
    assert ops[0].anchor == "b3"


def test_delete_single() -> None:
    text = "@@ delete b7 @@\n"
    _, ops, _ = parse_ops(text)
    assert ops[0].kind == "delete"
    assert ops[0].targets == ("b7",)
    assert ops[0].markdown is None


def test_delete_range() -> None:
    text = "@@ delete b2-b4 @@\n"
    _, ops, _ = parse_ops(text)
    assert ops[0].targets == ("b2", "b3", "b4")


def test_move_after() -> None:
    text = "@@ move b5 after b10 @@\n"
    _, ops, _ = parse_ops(text)
    o = ops[0]
    assert o.kind == "move"
    assert o.targets == ("b5",)
    assert o.anchor == "b10"
    assert o.side == "after"
    assert o.markdown is None


def test_move_before() -> None:
    text = "@@ move b2 before b9 @@\n"
    _, ops, _ = parse_ops(text)
    assert ops[0].anchor == "b9"
    assert ops[0].side == "before"


def test_move_range() -> None:
    text = "@@ move b5-b6 after b10 @@\n"
    _, ops, _ = parse_ops(text)
    assert ops[0].targets == ("b5", "b6")
    assert ops[0].anchor == "b10"
    assert ops[0].side == "after"


# --- 2. Reply text ----------------------------------------------------------


def test_reply_before_first_header() -> None:
    text = "Hello there\n@@ replace b1 @@\ncontent\n"
    reply, ops, _ = parse_ops(text)
    assert reply == "Hello there"
    assert len(ops) == 1


def test_prose_no_headers_reply_only() -> None:
    reply, ops, skips = parse_ops("Just text\nmore text\n")
    assert reply == "Just text\nmore text"
    assert ops == [] and skips == []


def test_reply_truncated_to_600() -> None:
    reply, _, _ = parse_ops("x" * 700)
    assert len(reply) == 600


# --- 3. @@ inside body stays body -------------------------------------------


def test_at_at_in_body_stays_body() -> None:
    text = "@@ replace b1 @@\n@@ not a header @@\n@@ replace x @@\n"
    _, ops, _ = parse_ops(text)
    assert ops[0].markdown == "@@ not a header @@\n@@ replace x @@"


# --- 4. @@ end @@ stops parsing ---------------------------------------------


def test_end_stops_parsing() -> None:
    text = "@@ replace b1 @@\nhello\n@@ end @@\n@@ replace b2 @@\nignored\n"
    reply, ops, _ = parse_ops(text)
    assert reply == ""
    assert len(ops) == 1
    assert ops[0].targets == ("b1",)


# --- 5. Bad ranges ----------------------------------------------------------


def test_reversed_range_skip() -> None:
    _, _, skips = parse_ops("@@ replace b6-b5 @@\nbody\n")
    assert len(skips) == 1
    assert skips[0].code == "bad_range"
    assert skips[0].header == "@@ replace b6-b5 @@"


def test_range_over_1000_skip() -> None:
    _, _, skips = parse_ops("@@ replace b1-b1001 @@\nbody\n")
    assert len(skips) == 1
    assert skips[0].code == "bad_range"


# --- 6. 45 replace ops → 40 Op + 5 Skip -------------------------------------


def test_too_many_ops() -> None:
    lines: list[str] = []
    for i in range(1, 46):
        lines.append(f"@@ replace b{i} @@")
        lines.append(f"body {i}")
    _, ops, skips = parse_ops("\n".join(lines))
    assert len(ops) == 40
    assert len(skips) == 5
    assert all(s.code == "too_many_ops" for s in skips)


# --- 7. cut_off --------------------------------------------------------------


def test_cut_off_drops_last_open_op() -> None:
    text = "@@ replace b1 @@\nfirst\n@@ replace b2 @@\nsecond\n"
    _, ops, skips = parse_ops(text, complete=False)
    assert len(ops) == 1 and ops[0].targets == ("b1",)
    assert len(skips) == 1
    assert skips[0].code == "cut_off"
    assert skips[0].header == "@@ replace b2 @@"


def test_complete_keeps_last_op() -> None:
    text = "@@ replace b1 @@\nfirst\n@@ replace b2 @@\nsecond\n"
    _, ops, skips = parse_ops(text, complete=True)
    assert len(ops) == 2
    assert ops[1].targets == ("b2",)
    assert skips == []


# --- 8. Body stripping & delete/move markdown --------------------------------


def test_body_blank_lines_stripped_internal_kept() -> None:
    text = "@@ replace b1 @@\n\nhello\n\nworld\n\n"
    _, ops, _ = parse_ops(text)
    assert ops[0].markdown == "hello\n\nworld"


def test_delete_ignores_body() -> None:
    _, ops, _ = parse_ops("@@ delete b1 @@\nsome body\n")
    assert ops[0].markdown is None


def test_move_ignores_body() -> None:
    _, ops, _ = parse_ops("@@ move b1 after b2 @@\nsome body\n")
    assert ops[0].markdown is None


# --- 9. Streaming ------------------------------------------------------------


def test_streaming_char_by_char_matches_whole() -> None:
    text = "Reply here\n@@ replace b1 @@\ncontent\n@@ delete b2 @@\n"

    p1 = EditParser()
    items1: list[Item] = p1.feed(text)
    items1.extend(p1.finish(True))

    p2 = EditParser()
    items2: list[Item] = []
    for ch in text:
        items2.extend(p2.feed(ch))
    items2.extend(p2.finish(True))

    assert items1 == items2


def test_streaming_reply_only_whole_lines() -> None:
    p = EditParser()
    assert p.feed("hello ") == []
    assert p.feed("world\n") == [Reply("hello world\n")]


# --- 10. Unicode -------------------------------------------------------------


def test_unicode_vietnamese_body() -> None:
    body = "Tiếng Việt là ngôn ngữ đẹp"
    _, ops, _ = parse_ops(f"@@ replace b1 @@\n{body}\n")
    assert ops[0].markdown == body
