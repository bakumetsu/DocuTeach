from __future__ import annotations

import json
from pathlib import Path

import pytest

from docuteach.skills.format import SkillSpec
from docuteach.skills.format import parse_skill as real_parse_skill
from docuteach.skills.registry import (
    FIXED_LINE,
    Skill,
    SkillRegistry,
    assemble_prompt,
)


def _write(d: Path, slug: str, command: str, extra: str = "") -> None:
    body = "x" * 30
    (d / f"{slug}.md").write_text(
        f"---\ncommand: {command}\nname: {slug}\ndescription: test\n"
        f"insertAs: text\n---\n{body}{extra}",
        encoding="utf-8",
    )


def test_name_mismatch_and_ignored_files(tmp_path: Path) -> None:
    user = tmp_path / "skills"
    user.mkdir()
    _write(user, "other", "/ccq")
    (user / "_state.json").write_text("{}", encoding="utf-8")
    (user / "x.md.bak").write_text("ignored", encoding="utf-8")
    trash = user / ".trash"
    trash.mkdir()
    (trash / "valid.md").write_text(
        "---\ncommand: /valid\nname: valid\ndescription: d\ninsertAs: text\n---\n" + "x" * 30,
        encoding="utf-8",
    )
    reg = SkillRegistry(user)
    broken = reg.broken()
    assert len(broken) == 1
    assert broken[0].code == "bad_command"
    assert len(reg.runnable()) == 3


def test_hidden_state(tmp_path: Path) -> None:
    user = tmp_path / "skills"
    user.mkdir()
    _write(user, "hw", "/hw")
    (user / "_state.json").write_text(json.dumps({"hidden": ["/drills", "/hw"]}), encoding="utf-8")
    reg = SkillRegistry(user)
    assert reg.get("/drills") is None
    assert "/drills" not in [s.command for s in reg.runnable()]
    assert reg.get("/hw") is not None
    assert "/hw" in [s.command for s in reg.runnable()]
    (user / "_state.json").write_text("not json", encoding="utf-8")
    reg2 = SkillRegistry(user)
    assert reg2.get("/drills") is not None


def test_user_file_cache(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    user = tmp_path / "skills"
    user.mkdir()
    _write(user, "ccq", "/ccq")
    reg = SkillRegistry(user)
    user_content = (user / "ccq.md").read_bytes()
    calls: list[bytes] = []

    def counting_parse(raw: bytes) -> SkillSpec:
        calls.append(raw)
        return real_parse_skill(raw)

    monkeypatch.setattr("docuteach.skills.store.parse_skill", counting_parse)
    reg.runnable()
    reg.runnable()
    assert calls.count(user_content) == 1
    _write(user, "ccq", "/ccq", extra="y" * 10)
    reg.runnable()
    new_content = (user / "ccq.md").read_bytes()
    assert new_content in calls


def test_assemble_prompt_text_skill() -> None:
    skill = Skill(
        command="/t",
        name="t",
        description="d",
        insert_as="text",
        tag="t",
        body="Do it.",
        origin="custom",
    )
    result = assemble_prompt(skill)
    assert result.endswith(FIXED_LINE)
    assert "Use paragraphs and lists only." in result
