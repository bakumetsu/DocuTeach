"""Tests for docuteach.store.checkpoints CRUD and pruning."""

from __future__ import annotations

from pathlib import Path

import pytest

from docuteach.config import Settings
from docuteach.errors import ApiError
from docuteach.store.checkpoints import (
    create_checkpoint,
    list_checkpoints,
    remove_checkpoint,
    restore_checkpoint,
    sweep_orphans,
)
from docuteach.store.library import Library


@pytest.fixture
def lesson_dir(library: Library) -> Path:
    meta = library.create_lesson("t")
    return library.require_dir(meta.id)


@pytest.fixture
def small_caps(settings: Settings) -> Settings:
    return settings.model_copy(update={"checkpoint_cap": 2, "auto_checkpoint_cap": 2})


class TestCreateAndList:
    def test_create_and_list_newest_first(self, lesson_dir: Path, settings: Settings) -> None:
        cp1 = create_checkpoint(lesson_dir, settings, "first", "md1")
        cp2 = create_checkpoint(lesson_dir, settings, "second", "md2")

        cps = list_checkpoints(lesson_dir)
        assert len(cps) == 2
        assert {c.id for c in cps} == {cp1.id, cp2.id}
        assert cps[0].id == cp2.id

    def test_orphan_ignored_by_list(self, lesson_dir: Path, settings: Settings) -> None:
        cp = create_checkpoint(lesson_dir, settings, "real", "content")
        orphan = lesson_dir / "checkpoints" / "orphan-abc123.md"
        orphan.write_bytes(b"orphan content")

        cps = list_checkpoints(lesson_dir)
        assert "orphan-abc123" not in {c.id for c in cps}
        assert cp.id in {c.id for c in cps}

    def test_sweep_orphans_removes(self, lesson_dir: Path, settings: Settings) -> None:
        cp = create_checkpoint(lesson_dir, settings, "real", "content")
        orphan = lesson_dir / "checkpoints" / "orphan-abc123.md"
        orphan.write_bytes(b"orphan content")

        count = sweep_orphans(lesson_dir)
        assert count == 1
        assert not orphan.exists()
        assert (lesson_dir / "checkpoints" / f"{cp.id}.md").exists()


class TestCaps:
    def test_manual_cap_prunes_oldest(self, lesson_dir: Path, small_caps: Settings) -> None:
        cp1 = create_checkpoint(lesson_dir, small_caps, "m1", "md1")
        cp2 = create_checkpoint(lesson_dir, small_caps, "m2", "md2")
        cp3 = create_checkpoint(lesson_dir, small_caps, "m3", "md3")

        deleted = lesson_dir / "checkpoints" / "_deleted"
        assert (deleted / f"{cp1.id}.json").exists()
        assert (lesson_dir / "checkpoints" / f"{cp2.id}.json").exists()
        assert (lesson_dir / "checkpoints" / f"{cp3.id}.json").exists()

    def test_auto_cap_prunes_oldest(self, lesson_dir: Path, small_caps: Settings) -> None:
        cp1 = create_checkpoint(lesson_dir, small_caps, "a1", "md1", auto=True)
        cp2 = create_checkpoint(lesson_dir, small_caps, "a2", "md2", auto=True)
        cp3 = create_checkpoint(lesson_dir, small_caps, "a3", "md3", auto=True)

        deleted = lesson_dir / "checkpoints" / "_deleted"
        assert (deleted / f"{cp1.id}.json").exists()
        assert (lesson_dir / "checkpoints" / f"{cp2.id}.json").exists()
        assert (lesson_dir / "checkpoints" / f"{cp3.id}.json").exists()

    def test_before_open_never_pruned(self, lesson_dir: Path, small_caps: Settings) -> None:
        cp_bo = create_checkpoint(lesson_dir, small_caps, "Before open", "bo_md", auto=True)
        cp1 = create_checkpoint(lesson_dir, small_caps, "auto1", "md1", auto=True)
        create_checkpoint(lesson_dir, small_caps, "auto2", "md2", auto=True)

        ids = {c.id for c in list_checkpoints(lesson_dir)}
        assert cp_bo.id in ids

        deleted = lesson_dir / "checkpoints" / "_deleted"
        assert (deleted / f"{cp1.id}.json").exists()


class TestRemoveRestore:
    def test_remove_then_restore(self, lesson_dir: Path, settings: Settings) -> None:
        cp = create_checkpoint(lesson_dir, settings, "to_remove", "content")

        remove_checkpoint(lesson_dir, cp.id)
        assert not (lesson_dir / "checkpoints" / f"{cp.id}.json").exists()
        assert (lesson_dir / "checkpoints" / "_deleted" / f"{cp.id}.json").exists()

        restored = restore_checkpoint(lesson_dir, cp.id)
        assert restored.id == cp.id
        assert restored.name == "to_remove"
        assert restored.markdown == "content"
        assert (lesson_dir / "checkpoints" / f"{cp.id}.json").exists()

    def test_unknown_id_not_found(self, lesson_dir: Path, settings: Settings) -> None:
        with pytest.raises(ApiError) as exc:
            remove_checkpoint(lesson_dir, "nonexistent-id")
        assert exc.value.code == "not_found"
        assert exc.value.status == 404

        with pytest.raises(ApiError) as exc:
            restore_checkpoint(lesson_dir, "nonexistent-id")
        assert exc.value.code == "not_found"
        assert exc.value.status == 404

    def test_bad_checkpoint_id_rejected(self, lesson_dir: Path, settings: Settings) -> None:
        with pytest.raises(ApiError) as exc:
            remove_checkpoint(lesson_dir, "../x")
        assert exc.value.code == "bad_id"
        assert exc.value.status == 400

        with pytest.raises(ApiError) as exc:
            restore_checkpoint(lesson_dir, "../x")
        assert exc.value.code == "bad_id"
        assert exc.value.status == 400
