"""Tests for docuteach.store.files atomic-write helpers."""

from __future__ import annotations

import errno
import os
import shutil
import stat
import time
from pathlib import Path

import anyio
import pytest

from docuteach.errors import ApiError
from docuteach.store.files import read_text_lenient, sweep_tmp, write_atomic
from docuteach.store.library import Library


class TestWriteAtomic:
    def test_basic_write_and_backup(self, tmp_path: Path) -> None:
        target = tmp_path / "lesson.md"
        write_atomic(target, b"first")
        assert target.read_bytes() == b"first"
        write_atomic(target, b"second", backup=True)
        assert target.read_bytes() == b"second"
        bak = tmp_path / "lesson.md.bak"
        assert bak.read_bytes() == b"first"

    def test_crash_simulation(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        target = tmp_path / "data.txt"
        target.write_bytes(b"original")
        tmp = tmp_path / "data.txt.tmp"

        def _crash(*args: object, **kwargs: object) -> None:
            raise OSError("simulated crash during replace")

        monkeypatch.setattr(os, "replace", _crash)
        with pytest.raises(OSError, match="simulated crash"):
            write_atomic(target, b"new content")

        assert target.read_bytes() == b"original"
        assert tmp.exists()
        assert sweep_tmp(tmp_path) == 1
        assert not tmp.exists()

    def test_permission_error_file_busy(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        target = tmp_path / "locked.txt"

        def _perm(*args: object, **kwargs: object) -> None:
            raise PermissionError("file locked")

        monkeypatch.setattr(os, "replace", _perm)

        def _noop(_s: float) -> None:
            pass

        monkeypatch.setattr(time, "sleep", _noop)

        with pytest.raises(ApiError) as exc:
            write_atomic(target, b"hello")

        assert exc.value.code == "file_busy"
        assert exc.value.status == 503

    def test_enospc_disk_full(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        target = tmp_path / "full.txt"

        def _enospc(fd: int) -> None:
            raise OSError(errno.ENOSPC, "No space left on device")

        monkeypatch.setattr(os, "fsync", _enospc)

        with pytest.raises(ApiError) as exc:
            write_atomic(target, b"data")

        assert exc.value.code == "disk_full"
        assert exc.value.status == 507

    def test_crlf_bytes_exact(self, tmp_path: Path) -> None:
        target = tmp_path / "crlf.txt"
        payload = b"line1\r\nline2\r\nline3\r\n"
        write_atomic(target, payload)
        assert target.read_bytes() == payload


class TestReadTextLenient:
    def test_strips_bom(self, tmp_path: Path) -> None:
        p = tmp_path / "bom.txt"
        p.write_bytes(b"\xef\xbb\xbfhello world")
        text, replaced = read_text_lenient(p)
        assert text == "hello world"
        assert replaced is False


@pytest.mark.anyio
async def test_concurrent_saves(library: Library) -> None:
    meta = library.create_lesson("t")
    lid = meta.id
    dir_path = library.require_dir(lid)

    text_a = "concurrent text A"
    text_b = "concurrent text B"

    async def _save(text: str) -> None:
        async with library.lock(lid):
            await anyio.to_thread.run_sync(library.write_doc, lid, text)

    async with anyio.create_task_group() as tg:
        tg.start_soon(_save, text_a)
        tg.start_soon(_save, text_b)

    content = (dir_path / "lesson.md").read_text(encoding="utf-8")
    assert content in (text_a, text_b)


def test_read_only_target(tmp_path: Path) -> None:
    target = tmp_path / "readonly.md"
    write_atomic(target, b"original")
    os.chmod(target, stat.S_IREAD)
    try:
        with pytest.raises(ApiError) as exc:
            write_atomic(target, b"new content")
        assert exc.value.code == "read_only"
        assert exc.value.status == 403
    finally:
        os.chmod(target, stat.S_IWRITE)


def test_save_after_folder_deleted(library: Library) -> None:
    meta = library.create_lesson("x")
    lid = meta.id
    dir_path = library.require_dir(lid)
    shutil.rmtree(dir_path)
    with pytest.raises(ApiError) as exc:
        library.write_doc(lid, "x")
    assert exc.value.code == "not_found"
    assert exc.value.status == 404
