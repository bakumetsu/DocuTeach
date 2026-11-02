"""Tests for the library store (LessonMeta CRUD, doc, chats, trash)."""

from __future__ import annotations

import json
import time
from typing import Any

import pytest

from docuteach.config import Settings
from docuteach.errors import ApiError
from docuteach.store.checkpoints import list_checkpoints
from docuteach.store.library import Library

# ── create ──────────────────────────────────────────────────────────────────


def test_create_empty_title(library: Library) -> None:
    meta = library.create_lesson("")
    assert meta.title == "Untitled lesson"
    assert meta.id.startswith("untitled-lesson-")


def test_create_title_only_spaces_dots(library: Library) -> None:
    meta = library.create_lesson(" . . . ")
    assert meta.title == "Untitled lesson"


def test_create_title_over_120_trimmed(library: Library) -> None:
    long_title = "a" * 200
    meta = library.create_lesson(long_title)
    assert len(meta.title) <= 120


def test_create_same_title_different_ids(library: Library) -> None:
    m1 = library.create_lesson("Duplicate")
    m2 = library.create_lesson("Duplicate")
    assert m1.id != m2.id


def test_create_vietnamese_slug(library: Library) -> None:
    meta = library.create_lesson("Thì hiện tại hoàn thành")
    assert meta.id.startswith("thi-hien-tai-hoan-thanh-")


# ── id validation / traversal ───────────────────────────────────────────────


def test_id_traversal_dot_dot(library: Library) -> None:
    with pytest.raises(ApiError) as exc_info:
        library.lesson_dir("..")
    assert exc_info.value.code == "bad_id"
    assert exc_info.value.status == 400


def test_id_traversal_dot_dot_x(library: Library) -> None:
    with pytest.raises(ApiError) as exc_info:
        library.lesson_dir("../x")
    assert exc_info.value.code == "bad_id"


def test_id_con_lowercase_ok_with_suffix(library: Library) -> None:
    meta = library.create_lesson("con")
    assert meta.id.startswith("con-")
    # The id itself is valid
    d = library.lesson_dir(meta.id)
    assert d.is_dir()


def test_id_uppercase_rejected(library: Library) -> None:
    with pytest.raises(ApiError) as exc_info:
        library.lesson_dir("CON")
    assert exc_info.value.code == "bad_id"


def test_id_too_long_rejected(library: Library) -> None:
    with pytest.raises(ApiError) as exc_info:
        library.lesson_dir("a" * 65)
    assert exc_info.value.code == "bad_id"


# ── rename ──────────────────────────────────────────────────────────────────


def test_rename_keeps_id(library: Library) -> None:
    meta = library.create_lesson("Original")
    lid = meta.id
    updated = library.rename_lesson(lid, "Renamed")
    assert updated.id == lid
    assert updated.title == "Renamed"


# ── list order ──────────────────────────────────────────────────────────────


def test_list_order_newest_first(library: Library) -> None:
    m1 = library.create_lesson("old")
    m2 = library.create_lesson("new")
    d1 = library.require_dir(m1.id)
    d2 = library.require_dir(m2.id)
    (d1 / "lesson.json").write_text(
        json.dumps(
            {
                "v": 1,
                "id": m1.id,
                "title": "old",
                "createdAt": "2024-01-01T00:00:00Z",
                "updatedAt": "2024-01-01T00:00:00Z",
            }
        ),
        encoding="utf-8",
    )
    (d2 / "lesson.json").write_text(
        json.dumps(
            {
                "v": 1,
                "id": m2.id,
                "title": "new",
                "createdAt": "2024-06-01T00:00:00Z",
                "updatedAt": "2024-06-01T00:00:00Z",
            }
        ),
        encoding="utf-8",
    )
    lessons = library.list_lessons()
    assert [m.id for m in lessons] == [m2.id, m1.id]


# ── adoption of hand-made folders ───────────────────────────────────────────


def test_adopt_folder_with_lesson_md_only(library: Library) -> None:
    lessons_dir = library.settings.lessons_dir
    lessons_dir.mkdir(parents=True, exist_ok=True)
    folder = lessons_dir / "my-hand-made-lesson-abc123"
    folder.mkdir()
    (folder / "lesson.md").write_text("# My Adopted Title\n\ncontent\n", encoding="utf-8")
    metas = library.list_lessons()
    adopted = [m for m in metas if m.id == "my-hand-made-lesson-abc123"]
    assert len(adopted) == 1
    assert adopted[0].title == "My Adopted Title"


def test_adopt_folder_with_no_files_ignored(library: Library) -> None:
    lessons_dir = library.settings.lessons_dir
    lessons_dir.mkdir(parents=True, exist_ok=True)
    folder = lessons_dir / "empty-folder-abc123"
    folder.mkdir()
    metas = library.list_lessons()
    assert all(m.id != "empty-folder-abc123" for m in metas)


# ── corrupt lesson.json ─────────────────────────────────────────────────────


def test_corrupt_lesson_json_rebuilt(library: Library) -> None:
    meta = library.create_lesson("corrupt test")
    lid = meta.id
    d = library.require_dir(lid)
    (d / "lesson.json").write_text("NOT VALID JSON {{{", encoding="utf-8")
    # Re-list triggers rebuild
    metas = library.list_lessons()
    found = [m for m in metas if m.id == lid]
    assert len(found) == 1
    assert found[0].title == "corrupt test"
    # Original corrupt file was renamed
    corrupt_files = list(d.glob("lesson.json.corrupt-*"))
    assert len(corrupt_files) == 1


# ── read_doc ────────────────────────────────────────────────────────────────


def test_read_doc_missing_md_empty(library: Library) -> None:
    meta = library.create_lesson("no md")
    lid = meta.id
    d = library.require_dir(lid)
    (d / "lesson.md").unlink()
    doc, used_replacement = library.read_doc(lid)
    assert doc.markdown == ""
    assert used_replacement is False


def test_read_doc_bom_stripped(library: Library) -> None:
    meta = library.create_lesson("bom")
    lid = meta.id
    d = library.require_dir(lid)
    (d / "lesson.md").write_bytes(b"\xef\xbb\xbf# BOM\n")
    doc, used_replacement = library.read_doc(lid)
    assert doc.markdown == "# BOM\n"
    assert used_replacement is False


def test_read_doc_invalid_utf8_flagged(library: Library) -> None:
    meta = library.create_lesson("bad utf8")
    lid = meta.id
    d = library.require_dir(lid)
    (d / "lesson.md").write_bytes(b"# Bad \xff\xfe\n")
    doc, used_replacement = library.read_doc(lid)
    assert used_replacement is True
    assert "\ufffd" in doc.markdown


# ── write_doc ───────────────────────────────────────────────────────────────


def test_write_doc_too_large(library: Library) -> None:
    meta = library.create_lesson("big doc")
    lid = meta.id
    with pytest.raises(ApiError) as exc_info:
        library.write_doc(lid, "x" * 5_000_001)
    assert exc_info.value.code == "too_large"
    assert exc_info.value.status == 413


def test_write_doc_creates_bak(library: Library) -> None:
    meta = library.create_lesson("bak test")
    lid = meta.id
    d = library.require_dir(lid)
    original = (d / "lesson.md").read_text(encoding="utf-8")
    library.write_doc(lid, "# New\n")
    bak = d / "lesson.md.bak"
    assert bak.exists()
    assert bak.read_text(encoding="utf-8") == original


def test_external_edit_creates_checkpoint(library: Library) -> None:
    meta = library.create_lesson("ext edit")
    lid = meta.id
    # Read to prime the hash
    library.read_doc(lid)
    d = library.require_dir(lid)
    # Simulate external edit
    (d / "lesson.md").write_bytes(b"# External change\n")
    # Now write via the API
    library.write_doc(lid, "# App content\n")
    cps = list_checkpoints(d)
    ext = [c for c in cps if c.name == "External edit"]
    assert len(ext) == 1
    assert ext[0].auto is True
    assert ext[0].markdown == "# External change\n"
    # New content is what's on disk
    doc, _ = library.read_doc(lid)
    assert doc.markdown == "# App content\n"


# ── chats ───────────────────────────────────────────────────────────────────


def test_chats_roundtrip(library: Library) -> None:
    meta = library.create_lesson("chats")
    lid = meta.id
    assert library.read_chats(lid) == []
    chats: list[dict[str, Any]] = [{"id": "c1", "messages": []}]
    library.write_chats(lid, chats)
    assert library.read_chats(lid) == chats


def test_chats_too_large(library: Library) -> None:
    meta = library.create_lesson("chats big")
    lid = meta.id
    big: list[dict[str, Any]] = [{"data": "x" * 6_000_000}]
    with pytest.raises(ApiError) as exc_info:
        library.write_chats(lid, big)
    assert exc_info.value.code == "too_large"
    assert exc_info.value.status == 413


# ── delete / restore / trash ────────────────────────────────────────────────


def test_delete_moves_to_trash_and_restore(library: Library) -> None:
    meta = library.create_lesson("delete me")
    lid = meta.id
    library.delete_lesson(lid)
    trash_dir = library.settings.lessons_dir / ".trash"
    entries = [p for p in trash_dir.iterdir() if p.name.startswith(f"{lid}__")]
    assert len(entries) == 1
    # Restore
    restored = library.restore_lesson(lid)
    assert restored.id == lid
    assert (library.require_dir(lid) / "lesson.md").exists()


def test_restore_when_id_taken_gets_new_id(library: Library) -> None:
    meta = library.create_lesson("conflict")
    lid = meta.id
    library.delete_lesson(lid)
    # Manually create a lesson with the same id to simulate conflict
    conflict_dir = library.lesson_dir(lid)
    conflict_dir.mkdir(parents=True, exist_ok=True)
    (conflict_dir / "lesson.json").write_text(
        json.dumps(
            {
                "v": 1,
                "id": lid,
                "title": "New",
                "createdAt": "2024-01-01T00:00:00Z",
                "updatedAt": "2024-01-01T00:00:00Z",
            }
        ),
        encoding="utf-8",
    )
    (conflict_dir / "lesson.md").write_text("# New\n", encoding="utf-8")
    restored = library.restore_lesson(lid)
    assert restored.id != lid
    assert (library.lesson_dir(lid) / "lesson.md").exists()
    assert (library.lesson_dir(restored.id) / "lesson.md").exists()


def test_purge_trash_older_than_trash_days(library: Library) -> None:
    meta = library.create_lesson("purge me")
    lid = meta.id
    library.delete_lesson(lid)
    trash_dir = library.settings.lessons_dir / ".trash"
    entries = [p for p in trash_dir.iterdir() if p.name.startswith(f"{lid}__")]
    assert len(entries) == 1
    old_entry = entries[0]
    # Rename with a timestamp 31 days in the past
    old_ts = int(time.time()) - 31 * 86_400
    old_entry.rename(trash_dir / f"{lid}__{old_ts}")
    library.startup()
    assert not (trash_dir / f"{lid}__{old_ts}").exists()


def test_not_found_unknown_lesson(library: Library) -> None:
    with pytest.raises(ApiError) as exc_info:
        library.require_dir("nonexistent-abc123")
    assert exc_info.value.code == "not_found"
    assert exc_info.value.status == 404


def test_first_save_after_restart_makes_no_external_edit(
    library: Library, settings: Settings
) -> None:
    meta = library.create_lesson("restart")
    lid = meta.id
    fresh = Library(settings)
    fresh.write_doc(lid, "# x\n")
    cps = list_checkpoints(fresh.require_dir(lid))
    assert all(c.name != "External edit" for c in cps)


def test_corrupt_chats_preserved(library: Library) -> None:
    meta = library.create_lesson("corrupt chats")
    lid = meta.id
    d = library.require_dir(lid)
    (d / "chats.json").write_bytes(b"\xff\xfe\x00garbage")
    assert library.read_chats(lid) == []
    corrupt_files = list(d.glob("chats.json.corrupt-*"))
    assert len(corrupt_files) == 1
