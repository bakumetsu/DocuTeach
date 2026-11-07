from __future__ import annotations

from pathlib import Path

import pytest

from docuteach.errors import ApiError
from docuteach.skills.format import MAX_FILE_BYTES, parse_skill
from docuteach.skills.manage import SkillManager, build_spec, serialize_skill


def _fields(command: str = "/mine", **overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "command": command,
        "name": "Mine",
        "description": "A custom skill",
        "insertAs": "text",
        "body": "x" * 30,
    }
    base.update(overrides)
    return base


def _find_item(items: list[dict[str, object]], command: str) -> dict[str, object]:
    for item in items:
        if item.get("command") == command:
            return item
    raise AssertionError(f"command {command!r} not found")


@pytest.fixture()
def user_dir(tmp_path: Path) -> Path:
    d = tmp_path / "skills"
    d.mkdir()
    return d


@pytest.fixture()
def manager(user_dir: Path) -> SkillManager:
    return SkillManager(user_dir, 7)


def test_save_new_custom(manager: SkillManager) -> None:
    manager.save(_fields(), replace=False)
    item = _find_item(manager.list_all(), "/mine")
    assert item.get("command") == "/mine"
    assert item.get("source") == "custom"

    with pytest.raises(ApiError) as exc:
        manager.save(_fields(), replace=False)
    assert isinstance(exc.value, ApiError)
    assert exc.value.code == "skill_exists"


def test_import_preview_writes_nothing(manager: SkillManager, user_dir: Path) -> None:
    text = serialize_skill(build_spec(_fields())).decode("utf-8")
    preview = manager.import_preview(text)
    assert preview.get("clash") is None
    assert list(user_dir.glob("*.md")) == []

    manager.save(_fields(), replace=False)
    preview_after = manager.import_preview(text)
    assert preview_after.get("clash") == "custom"


def test_delete_custom_uses_trash(manager: SkillManager, user_dir: Path) -> None:
    manager.save(_fields(), replace=False)
    trash_id = manager.delete("mine")
    assert (user_dir / "mine.md").exists() is False

    item = manager.restore_trash(trash_id)
    assert item.get("command") == "/mine"
    assert (user_dir / "mine.md").exists() is True


def test_delete_builtin_hides_until_defaults_restored(manager: SkillManager) -> None:
    items = manager.list_all()
    builtin_items = [item for item in items if item.get("source") == "builtin"]
    if not builtin_items:
        pytest.skip("no built-in skills available")

    command = str(builtin_items[0].get("command"))
    slug = command.lstrip("/")
    trash_id = manager.delete(slug)
    assert trash_id == f"hide__{slug}"

    hidden_item = _find_item(manager.list_all(), command)
    assert hidden_item.get("hidden") is True

    manager.restore_defaults()
    restored_item = _find_item(manager.list_all(), command)
    assert restored_item.get("hidden") is False


def test_export_file_returns_yaml_bytes(manager: SkillManager) -> None:
    manager.save(_fields(), replace=False)
    filename, data = manager.export_file("mine")
    assert filename == "mine.md"
    assert data.startswith(b"---")


def test_import_commit_rename_keeps_clash(manager: SkillManager, user_dir: Path) -> None:
    manager.save(_fields(), replace=False)
    text = serialize_skill(build_spec(_fields())).decode("utf-8")

    item = manager.import_commit(text, "rename", "/mine2")
    assert item.get("command") == "/mine2"
    assert (user_dir / "mine.md").exists() is True
    assert (user_dir / "mine2.md").exists() is True

    with pytest.raises(ApiError) as exc:
        manager.import_commit(text, None, None)
    assert isinstance(exc.value, ApiError)
    assert exc.value.code == "skill_exists"


def test_import_preview_invalid_text_raises(manager: SkillManager) -> None:
    with pytest.raises(ApiError):
        manager.import_preview("not a skill")


def test_serialize_skill_round_trip() -> None:
    spec = build_spec(_fields())
    data = serialize_skill(spec)
    assert data.endswith(b"\n")
    reparsed = parse_skill(data)
    assert reparsed.command == spec.command
    assert reparsed.name == spec.name
    assert reparsed.body == spec.body


def test_import_preview_too_long(manager: SkillManager) -> None:
    with pytest.raises(ApiError) as exc:
        manager.import_preview("x" * (MAX_FILE_BYTES + 1))
    assert exc.value.code == "too_long"
    assert exc.value.status == 413


def test_import_preview_bad_field(manager: SkillManager) -> None:
    with pytest.raises(ApiError) as exc:
        manager.import_preview(123)  # type: ignore[arg-type]
    assert exc.value.code == "bad_field"


def test_import_preview_bad_encoding(manager: SkillManager) -> None:
    with pytest.raises(ApiError) as exc:
        manager.import_preview("\ud800")
    assert exc.value.code == "bad_encoding"


def test_delete_broken_file(manager: SkillManager, user_dir: Path) -> None:
    (user_dir / "weird name.md").write_text("garbage", encoding="utf-8")
    trash_id = manager.delete("weird name")
    assert trash_id


def test_delete_bad_slug(manager: SkillManager) -> None:
    for slug in ("../x", "", ".hidden", "_x"):
        with pytest.raises(ApiError) as exc:
            manager.delete(slug)
        assert exc.value.code == "bad_slug"


def test_build_spec_bad_tag() -> None:
    with pytest.raises(ApiError) as exc:
        build_spec(_fields(insertAs="text", tag="Oops"))
    assert exc.value.code == "bad_tag"
