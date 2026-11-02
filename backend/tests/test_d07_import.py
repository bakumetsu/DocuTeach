"""Tests for the D-07 one-time import (section 5.1)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, cast

from docuteach.config import Settings
from docuteach.store.d07_import import import_d07
from docuteach.store.library import Library

_DOC_KEY = "docuteach%3Av1%3Adoc%3Adraft.json"
_CKPT_KEY = "docuteach%3Av1%3Ackpt%3Adraft.json"
_CHATS_KEY = "docuteach%3Av1%3Achats%3Adraft.json"


def _write_key(path: Path, value: object) -> None:
    inner = json.dumps(value, ensure_ascii=False)
    path.write_text(json.dumps({"value": inner}), encoding="utf-8")


def _setup_data(
    settings: Settings,
    *,
    include_doc: bool = True,
    include_ckpt: bool = True,
    include_chats: bool = True,
    garbage_chats: bool = False,
) -> None:
    data_dir = settings.d07_data_dir
    data_dir.mkdir(parents=True, exist_ok=True)

    if include_doc:
        doc: dict[str, Any] = {
            "id": "draft",
            "markdown": "# Imported title\n\nbody",
            "updatedAt": "2026-10-30T10:00:00Z",
        }
        _write_key(data_dir / _DOC_KEY, doc)

    if include_ckpt:
        ckpts: list[dict[str, Any]] = [
            {
                "id": "cp-before",
                "name": "Before open",
                "createdAt": "2026-10-30T09:00:00Z",
                "markdown": "before text",
            },
            {
                "id": "cp-save",
                "name": "My save",
                "createdAt": "2026-10-30T10:00:00Z",
                "markdown": "saved text",
            },
        ]
        _write_key(data_dir / _CKPT_KEY, ckpts)

    if include_chats:
        if garbage_chats:
            (data_dir / _CHATS_KEY).write_text("!!!not-json!!!", encoding="utf-8")
        else:
            chats: list[dict[str, Any]] = [
                {"id": "chat-1", "messages": [{"role": "user", "content": "hi"}]}
            ]
            _write_key(data_dir / _CHATS_KEY, chats)


def test_import_creates_lesson(settings: Settings) -> None:
    _setup_data(settings)
    import_d07(settings)

    lesson_dir = settings.lessons_dir / "imported-lesson-d07"
    assert lesson_dir.is_dir()

    meta = json.loads((lesson_dir / "lesson.json").read_text(encoding="utf-8"))
    assert meta["title"] == "Imported title"
    assert meta["id"] == "imported-lesson-d07"
    assert meta["updatedAt"] == "2026-10-30T10:00:00Z"

    md = (lesson_dir / "lesson.md").read_text(encoding="utf-8")
    assert md == "# Imported title\n\nbody"

    ckpt_dir = lesson_dir / "checkpoints"
    before_meta = json.loads((ckpt_dir / "cp-before.json").read_text(encoding="utf-8"))
    assert before_meta["id"] == "cp-before"
    assert before_meta["name"] == "Before open"
    assert before_meta["auto"] is True

    save_meta = json.loads((ckpt_dir / "cp-save.json").read_text(encoding="utf-8"))
    assert save_meta["id"] == "cp-save"
    assert save_meta["name"] == "My save"
    assert save_meta["auto"] is False

    chats = json.loads((lesson_dir / "chats.json").read_text(encoding="utf-8"))
    assert isinstance(chats, list)
    assert len(cast(list[Any], chats)) == 1
    assert chats[0]["id"] == "chat-1"

    assert (settings.lessons_dir / ".imported-d07").exists()


def test_data_files_untouched(settings: Settings) -> None:
    _setup_data(settings)
    data_dir = settings.d07_data_dir
    before: dict[str, str] = {}
    for key in (_DOC_KEY, _CKPT_KEY, _CHATS_KEY):
        before[key] = (data_dir / key).read_text(encoding="utf-8")

    import_d07(settings)

    for key, content in before.items():
        assert (data_dir / key).read_text(encoding="utf-8") == content


def test_second_run_noop(settings: Settings) -> None:
    _setup_data(settings)
    import_d07(settings)

    marker = settings.lessons_dir / ".imported-d07"
    marker_content: str = marker.read_text(encoding="utf-8")
    lesson_dir = settings.lessons_dir / "imported-lesson-d07"
    (lesson_dir / "lesson.md").write_text("MODIFIED", encoding="utf-8")

    import_d07(settings)

    assert (lesson_dir / "lesson.md").read_text(encoding="utf-8") == "MODIFIED"
    assert marker.read_text(encoding="utf-8") == marker_content


def test_partial_rerun_overwrites(settings: Settings) -> None:
    _setup_data(settings)
    import_d07(settings)

    (settings.lessons_dir / ".imported-d07").unlink()
    import_d07(settings)

    lesson_dir = settings.lessons_dir / "imported-lesson-d07"
    assert (lesson_dir / "lesson.md").read_text(encoding="utf-8") == ("# Imported title\n\nbody")

    ckpt_dir = lesson_dir / "checkpoints"
    md_files = list(ckpt_dir.glob("*.md"))
    assert len(md_files) == 2

    assert (settings.lessons_dir / ".imported-d07").exists()


def test_missing_ckpt_skipped(settings: Settings) -> None:
    _setup_data(settings, include_ckpt=False)
    import_d07(settings)

    lesson_dir = settings.lessons_dir / "imported-lesson-d07"
    assert lesson_dir.is_dir()
    assert (lesson_dir / "lesson.md").exists()

    ckpt_dir = lesson_dir / "checkpoints"
    if ckpt_dir.exists():
        assert not list(ckpt_dir.glob("*.json"))

    report = settings.lessons_dir / "import_report.txt"
    assert report.exists()
    assert "ckpts" in report.read_text(encoding="utf-8")


def test_garbage_chats_noted_in_report(settings: Settings) -> None:
    _setup_data(settings, garbage_chats=True)
    import_d07(settings)

    lesson_dir = settings.lessons_dir / "imported-lesson-d07"
    assert lesson_dir.is_dir()
    assert not (lesson_dir / "chats.json").exists()

    report = settings.lessons_dir / "import_report.txt"
    assert report.exists()
    assert "chats" in report.read_text(encoding="utf-8")


def test_no_doc_key_no_import(settings: Settings) -> None:
    _setup_data(settings, include_doc=False)
    import_d07(settings)

    assert not (settings.lessons_dir / "imported-lesson-d07").exists()
    assert not (settings.lessons_dir / ".imported-d07").exists()


def test_library_startup_runs_import(settings: Settings) -> None:
    _setup_data(settings)
    lib = Library(settings)
    lib.startup()

    lessons = lib.list_lessons()
    ids = [m.id for m in lessons]
    assert "imported-lesson-d07" in ids


def test_unreadable_doc_no_marker(settings: Settings) -> None:
    _setup_data(settings)
    data_dir = settings.d07_data_dir
    (data_dir / _DOC_KEY).write_bytes(b"\xff\xfe\x00not-valid")
    import_d07(settings)
    assert not (settings.lessons_dir / ".imported-d07").exists()
    assert not (settings.lessons_dir / "imported-lesson-d07").exists()
