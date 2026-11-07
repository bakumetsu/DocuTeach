"""The answer key lists the option marked [x] in an MCQ."""

from __future__ import annotations

from docuteach.export.answer_key import build_answer_key
from docuteach.md.parser import parse_markdown


def test_mcq_correct_option_is_listed() -> None:
    md = "Which is correct?\n\n- [ ] She go\n- [x] She goes\n- [ ] She going\n"
    key = build_answer_key(parse_markdown(md).doc)
    lines = [ln for s in key.sections for ln in s.lines]
    assert [ln.text for ln in lines] == ["b"]
    assert key.warnings == ()
