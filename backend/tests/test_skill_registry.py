from __future__ import annotations

from pathlib import Path

from docuteach.skills.registry import SkillRegistry


def _write(d: Path, slug: str, command: str, extra: str = "") -> None:
    body = "x" * 30
    (d / f"{slug}.md").write_text(
        f"---\ncommand: {command}\nname: {slug}\ndescription: test\n"
        f"insertAs: text\n---\n{body}{extra}",
        encoding="utf-8",
    )


def test_missing_folder_defaults_to_builtins(tmp_path: Path) -> None:
    reg = SkillRegistry(tmp_path / "skills")
    runnable = reg.runnable()
    assert len(runnable) == 3
    assert all(s.origin == "builtin" for s in runnable)
    assert [s.command for s in runnable] == ["/ccq", "/drills", "/pitfalls"]
    assert reg.broken() == []


def test_user_override_and_add(tmp_path: Path) -> None:
    user = tmp_path / "skills"
    user.mkdir()
    _write(user, "ccq", "/ccq")
    _write(user, "hw", "/hw")
    reg = SkillRegistry(user)
    runnable = reg.runnable()
    by_cmd = {s.command: s for s in runnable}
    assert by_cmd["/ccq"].origin == "customized"
    assert by_cmd["/hw"].origin == "custom"
    assert runnable[-1].command == "/hw"


def test_broken_user_file(tmp_path: Path) -> None:
    user = tmp_path / "skills"
    user.mkdir()
    (user / "bad.md").write_text("nonsense", encoding="utf-8")
    reg = SkillRegistry(user)
    assert len(reg.runnable()) == 3
    broken = reg.broken()
    assert len(broken) == 1
    assert broken[0].reason

    (user / "ccq.md").write_text("nonsense", encoding="utf-8")
    reg2 = SkillRegistry(user)
    by_cmd = {s.command: s for s in reg2.runnable()}
    assert by_cmd["/ccq"].origin == "builtin"
