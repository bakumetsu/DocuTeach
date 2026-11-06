"""Step A tests: skill file format parsing."""

from __future__ import annotations

import importlib.resources
from pathlib import Path

import pytest

from docuteach.skills.format import SkillFormatError, parse_skill, slug_for

_BODY = "A valid prompt body for testing purposes."


def _valid(**kw: str) -> bytes:
    base: dict[str, str] = {
        "command": "/test",
        "name": "Test Skill",
        "description": "A test skill for validation",
        "insertAs": "text",
    }
    base.update(kw)
    parts = ["---", *[f"{k}: {v}" for k, v in base.items()], "---", _BODY]
    return "\n".join(parts).encode("utf-8")


# ── happy path ──────────────────────────────────────────────────────────────


def test_valid_minimal() -> None:
    spec = parse_skill(_valid())
    assert spec.command == "/test"
    assert spec.name == "Test Skill"
    assert spec.insert_as == "text"
    assert spec.body == _BODY


def test_tag_defaults_to_name() -> None:
    spec = parse_skill(_valid(insertAs="teacherNote"))
    assert spec.tag == "Test Skill"


def test_bom_and_crlf() -> None:
    raw = (
        b"\xef\xbb\xbf"
        + b"---\r\ncommand: /test\r\nname: T\r\ndescription: D\r\ninsertAs: text\r\n---\r\n"
        + _BODY.encode()
        + b"\r\n"
    )
    spec = parse_skill(raw)
    assert spec.command == "/test"
    assert spec.name == "T"


# ── error codes ─────────────────────────────────────────────────────────────


def test_too_long() -> None:
    with pytest.raises(SkillFormatError) as exc:
        parse_skill(b"x" * 16_385)
    assert exc.value.code == "too_long"


def test_bad_encoding() -> None:
    with pytest.raises(SkillFormatError) as exc:
        parse_skill(b"\xff\xfe\x80invalid")
    assert exc.value.code == "bad_encoding"


def test_bad_chars() -> None:
    raw = (
        b"---\ncommand: /test\nname: T\ndescription: D\ninsertAs: text\n---\n\x00"
        + _BODY.encode()
        + b"\n"
    )
    with pytest.raises(SkillFormatError) as exc:
        parse_skill(raw)
    assert exc.value.code == "bad_chars"


def test_bad_header_no_opening() -> None:
    with pytest.raises(SkillFormatError) as exc:
        parse_skill(b"hello\ncommand: /test\n")
    assert exc.value.code == "bad_header"


def test_bad_header_no_closing() -> None:
    raw = b"---\ncommand: /test\nname: T\ndescription: D\ninsertAs: text\n"
    with pytest.raises(SkillFormatError) as exc:
        parse_skill(raw)
    assert exc.value.code == "bad_header"


def test_bad_header_line_without_colon() -> None:
    raw = (
        b"---\ncommand: /test\nnotakeyvalue\nname: T\ndescription: D\ninsertAs: text\n---\n"
        + _BODY.encode()
        + b"\n"
    )
    with pytest.raises(SkillFormatError) as exc:
        parse_skill(raw)
    assert exc.value.code == "bad_header"


def test_unknown_key() -> None:
    raw = (
        b"---\ncommand: /test\nname: T\ndescription: D\ninsertAs: text\nfoo: bar\n---\n"
        + _BODY.encode()
        + b"\n"
    )
    with pytest.raises(SkillFormatError) as exc:
        parse_skill(raw)
    assert exc.value.code == "unknown_key"


def test_duplicate_key() -> None:
    raw = (
        b"---\ncommand: /test\ncommand: /other\nname: T\ndescription: D\ninsertAs: text\n---\n"
        + _BODY.encode()
        + b"\n"
    )
    with pytest.raises(SkillFormatError) as exc:
        parse_skill(raw)
    assert exc.value.code == "duplicate_key"


def test_missing_field() -> None:
    raw = b"---\nname: T\ndescription: D\ninsertAs: text\n---\n" + _BODY.encode() + b"\n"
    with pytest.raises(SkillFormatError) as exc:
        parse_skill(raw)
    assert exc.value.code == "missing_field"
    assert "command" in exc.value.reason


def test_bad_command() -> None:
    with pytest.raises(SkillFormatError) as exc:
        parse_skill(_valid(command="/Abc"))
    assert exc.value.code == "bad_command"


def test_reserved_command() -> None:
    with pytest.raises(SkillFormatError) as exc:
        parse_skill(_valid(command="/edit"))
    assert exc.value.code == "reserved_command"


def test_bad_insert_as() -> None:
    with pytest.raises(SkillFormatError) as exc:
        parse_skill(_valid(insertAs="markdown"))
    assert exc.value.code == "bad_insert_as"


def test_bad_tag_with_blanks() -> None:
    with pytest.raises(SkillFormatError) as exc:
        parse_skill(_valid(insertAs="blanks", tag="My Tag"))
    assert exc.value.code == "bad_tag"


def test_bad_body_too_short() -> None:
    raw = (
        b"---\ncommand: /test\nname: T\ndescription: D\ninsertAs: text\n---\n"
        + b"only nineteen char."
        + b"\n"
    )
    with pytest.raises(SkillFormatError) as exc:
        parse_skill(raw)
    assert exc.value.code == "bad_body"


def test_bad_body_too_long() -> None:
    body = "x" * 4001
    raw = (
        b"---\ncommand: /test\nname: T\ndescription: D\ninsertAs: text\n---\n"
        + body.encode()
        + b"\n"
    )
    with pytest.raises(SkillFormatError) as exc:
        parse_skill(raw)
    assert exc.value.code == "bad_body"


# ── command regex edge cases ────────────────────────────────────────────────


def test_command_one_char_too_short() -> None:
    with pytest.raises(SkillFormatError) as exc:
        parse_skill(_valid(command="/a"))
    assert exc.value.code == "bad_command"


def test_command_uppercase() -> None:
    with pytest.raises(SkillFormatError) as exc:
        parse_skill(_valid(command="/Abc"))
    assert exc.value.code == "bad_command"


def test_command_valid_hyphen_digit() -> None:
    spec = parse_skill(_valid(command="/ok-1"))
    assert spec.command == "/ok-1"


def test_command_25_chars_too_long() -> None:
    with pytest.raises(SkillFormatError) as exc:
        parse_skill(_valid(command="/a" + "a" * 24))
    assert exc.value.code == "bad_command"


# ── slug_for ────────────────────────────────────────────────────────────────


def test_slug_for() -> None:
    assert slug_for("/ccq") == "ccq"
    assert slug_for("/ok-1") == "ok-1"


# ── built-in files ──────────────────────────────────────────────────────────


def test_builtin_ccq() -> None:
    raw = (importlib.resources.files("docuteach.skills") / "builtin" / "ccq.md").read_bytes()
    spec = parse_skill(raw)
    assert spec.command == "/ccq"
    assert spec.insert_as == "teacherNote"
    assert spec.tag == "CCQ"


def test_builtin_drills() -> None:
    raw = (importlib.resources.files("docuteach.skills") / "builtin" / "drills.md").read_bytes()
    spec = parse_skill(raw)
    assert spec.command == "/drills"
    assert spec.insert_as == "blanks"
    assert spec.tag == "5 Drills"


def test_builtin_pitfalls() -> None:
    raw = (importlib.resources.files("docuteach.skills") / "builtin" / "pitfalls.md").read_bytes()
    spec = parse_skill(raw)
    assert spec.command == "/pitfalls"
    assert spec.insert_as == "teacherNote"
    assert spec.tag == "Pitfalls"


@pytest.mark.parametrize("command", ["ccq", "drills", "pitfalls"])
def test_builtin_prompt_matches_golden(command: str, tmp_path: Path) -> None:
    from docuteach.skills.registry import SkillRegistry, assemble_prompt

    skill = SkillRegistry(tmp_path / "skills").get("/" + command)
    assert skill is not None
    golden = Path(__file__).parent / "golden" / "skill_prompts" / f"{command}.txt"
    assert assemble_prompt(skill).encode("utf-8") == golden.read_bytes()
