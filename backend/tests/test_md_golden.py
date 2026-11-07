"""Golden tests for the DocuTeach Markdown parser."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from docuteach.md.model import to_json
from docuteach.md.parser import parse_markdown

FIXTURES = Path(__file__).resolve().parents[2] / "frontend" / "test" / "fixtures"
GOLDEN = Path(__file__).parent / "golden"
_MISSING = "__missing__"


def _require_fixtures() -> None:
    if not FIXTURES.is_dir():
        pytest.fail("frontend fixtures not found")


def _fixture_stems() -> list[str]:
    if not FIXTURES.is_dir():
        return [_MISSING]
    stems = sorted(path.stem for path in FIXTURES.glob("*.md") if path.is_file())
    return stems or [_MISSING]


def _golden_message(fixture_stems: set[str], golden_stems: set[str]) -> str:
    missing = sorted(fixture_stems - golden_stems)
    if missing:
        return (
            f"fixture {missing[0]} has no golden tree: "
            f"add backend/tests/golden/{missing[0]}.json"
        )
    extra = sorted(golden_stems - fixture_stems)
    return f"golden stems do not match fixture stems; extra: {', '.join(extra)}"


def test_every_fixture_has_a_golden() -> None:
    _require_fixtures()
    fixture_stems = {path.stem for path in FIXTURES.glob("*.md") if path.is_file()}
    golden_stems = {path.stem for path in GOLDEN.glob("*.json") if path.is_file()}
    assert fixture_stems == golden_stems, _golden_message(fixture_stems, golden_stems)


@pytest.mark.parametrize("stem", _fixture_stems())
def test_fixture_matches_golden(stem: str) -> None:
    _require_fixtures()
    if stem == _MISSING:
        pytest.fail("frontend fixtures not found")
    fixture_text = (FIXTURES / f"{stem}.md").read_text(encoding="utf-8")
    result = parse_markdown(fixture_text)
    golden_text = (GOLDEN / f"{stem}.json").read_text(encoding="utf-8")
    golden: object = json.loads(golden_text)
    expected: object = {"doc": to_json(result.doc), "warnings": list(result.warnings)}
    assert golden == expected


@pytest.mark.parametrize("stem", _fixture_stems())
def test_parse_never_raises(stem: str) -> None:
    _require_fixtures()
    if stem == _MISSING:
        pytest.fail("frontend fixtures not found")
    text = (FIXTURES / f"{stem}.md").read_text(encoding="utf-8").lstrip("\ufeff")
    baseline = parse_markdown(text)
    crlf = parse_markdown(text.replace("\n", "\r\n"))
    bom = parse_markdown("\ufeff" + text)
    assert baseline.doc == crlf.doc
    assert baseline.doc == bom.doc
