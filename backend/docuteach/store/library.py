"""Lesson and document library storage."""

from __future__ import annotations

import asyncio
import json
import re
import secrets
import shutil
import time
import unicodedata
from pathlib import Path
from typing import Any, cast

from docuteach.config import Settings
from docuteach.errors import ApiError
from docuteach.store.checkpoints import create_checkpoint, sweep_orphans
from docuteach.store.d07_import import import_d07
from docuteach.store.files import read_text_lenient, sha256_hex, sweep_tmp, write_atomic
from docuteach.store.models import DocRecord, LessonMeta, now_iso

_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")


class Library:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._locks: dict[str, asyncio.Lock] = {}
        self._md_hashes: dict[str, str] = {}

    def lock(self, lesson_id: str) -> asyncio.Lock:
        lock = self._locks.get(lesson_id)
        if lock is None:
            lock = asyncio.Lock()
            self._locks[lesson_id] = lock
        return lock

    def lesson_dir(self, lesson_id: str) -> Path:
        if not _ID_RE.match(lesson_id):
            raise ApiError("bad_id", f"invalid lesson id {lesson_id!r}", 400)
        base = self.settings.lessons_dir.resolve()
        path = (base / lesson_id).resolve()
        if not path.is_relative_to(base) or path.parent != base:
            raise ApiError("bad_id", "lesson path escapes lessons directory", 400)
        return path

    def require_dir(self, lesson_id: str) -> Path:
        path = self.lesson_dir(lesson_id)
        if not path.is_dir():
            raise ApiError("not_found", f"lesson {lesson_id} not found", 404)
        return path

    def startup(self) -> None:
        settings = self.settings
        lessons_dir = settings.lessons_dir
        lessons_dir.mkdir(parents=True, exist_ok=True)
        sweep_tmp(settings.data_dir)
        self._purge_trash()
        import_d07(settings)
        for path in self._iter_lesson_dirs():
            sweep_orphans(path)

    def list_lessons(self) -> list[LessonMeta]:
        self.settings.lessons_dir.mkdir(parents=True, exist_ok=True)
        metas: list[LessonMeta] = []
        for path in self._iter_lesson_dirs():
            if not (path / "lesson.md").exists() and not (path / "lesson.json").exists():
                continue
            meta = self._load_meta(path, path.name)
            metas.append(meta)
        metas.sort(key=lambda meta: meta.updated_at, reverse=True)
        return metas

    def create_lesson(self, title: str | None) -> LessonMeta:
        cleaned_title = self._clean_title(title)
        lesson_id = self._new_lesson_id(cleaned_title)
        lesson_dir = self.lesson_dir(lesson_id)
        while lesson_dir.exists():
            lesson_id = self._new_lesson_id(cleaned_title)
            lesson_dir = self.lesson_dir(lesson_id)
        lesson_dir.mkdir(parents=True, exist_ok=True)
        self._write_lesson_md(lesson_dir, cleaned_title)
        self._md_hashes[lesson_id] = sha256_hex((lesson_dir / "lesson.md").read_bytes())
        meta = LessonMeta(
            v=1,
            id=lesson_id,
            title=cleaned_title,
            created_at=now_iso(),
            updated_at=now_iso(),
        )
        self._write_meta(lesson_dir, meta)
        return meta

    def rename_lesson(self, lesson_id: str, title: str) -> LessonMeta:
        lesson_dir = self.require_dir(lesson_id)
        meta = self._load_meta(lesson_dir, lesson_id)
        meta.title = self._clean_title(title)
        meta.updated_at = now_iso()
        self._write_meta(lesson_dir, meta)
        return meta

    def read_doc(self, lesson_id: str) -> tuple[DocRecord, bool]:
        lesson_dir = self.require_dir(lesson_id)
        meta = self._load_meta(lesson_dir, lesson_id)
        path = lesson_dir / "lesson.md"
        if path.exists():
            raw = path.read_bytes()
            self._md_hashes[lesson_id] = sha256_hex(raw)
            markdown, used_replacement = read_text_lenient(path)
        else:
            markdown = ""
            used_replacement = False
            self._md_hashes[lesson_id] = sha256_hex(b"")
        doc = DocRecord(id=lesson_id, markdown=markdown, updated_at=meta.updated_at)
        return doc, used_replacement

    def write_doc(self, lesson_id: str, markdown: str) -> DocRecord:
        raw = markdown.encode("utf-8")
        if len(raw) > self.settings.max_markdown_bytes:
            raise ApiError("too_large", "Markdown exceeds the maximum size", 413)
        lesson_dir = self.require_dir(lesson_id)
        path = lesson_dir / "lesson.md"
        if path.exists():
            disk_hash = sha256_hex(path.read_bytes())
            remembered = self._md_hashes.get(lesson_id)
            if remembered is not None and disk_hash != remembered:
                disk_text, _ = read_text_lenient(path)
                create_checkpoint(lesson_dir, self.settings, "External edit", disk_text, auto=True)
            self._md_hashes[lesson_id] = disk_hash
        else:
            self._md_hashes.pop(lesson_id, None)
        write_atomic(path, raw, backup=True)
        meta = self._load_meta(lesson_dir, lesson_id)
        meta.updated_at = now_iso()
        self._write_meta(lesson_dir, meta)
        self._md_hashes[lesson_id] = sha256_hex(raw)
        return DocRecord(id=lesson_id, markdown=markdown, updated_at=meta.updated_at)

    def read_chats(self, lesson_id: str) -> list[dict[str, Any]]:
        lesson_dir = self.require_dir(lesson_id)
        path = lesson_dir / "chats.json"
        if not path.exists():
            return []
        text, _ = read_text_lenient(path)
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            self._rename_corrupt(path)
            return []
        if not isinstance(data, list):
            self._rename_corrupt(path)
            return []
        items = cast(list[Any], data)
        return [cast(dict[str, Any], item) for item in items if isinstance(item, dict)]

    def write_chats(self, lesson_id: str, chats: list[dict[str, Any]]) -> None:
        lesson_dir = self.require_dir(lesson_id)
        raw = json.dumps(chats, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        if len(raw) > self.settings.max_chats_bytes:
            raise ApiError("too_large", "Chats exceed the maximum size", 413)
        write_atomic(lesson_dir / "chats.json", raw, backup=True)

    def delete_lesson(self, lesson_id: str) -> str:
        lesson_dir = self.require_dir(lesson_id)
        trash_dir = self.settings.lessons_dir / ".trash"
        trash_dir.mkdir(parents=True, exist_ok=True)
        ts = int(time.time())
        target = trash_dir / f"{lesson_id}__{ts}"
        while target.exists():
            ts += 1
            target = trash_dir / f"{lesson_id}__{ts}"
        lesson_dir.rename(target)
        self._md_hashes.pop(lesson_id, None)
        return lesson_id

    def restore_lesson(self, lesson_id: str) -> LessonMeta:
        lessons_dir = self.settings.lessons_dir
        trash_dir = lessons_dir / ".trash"
        if not trash_dir.is_dir():
            raise ApiError("not_found", f"trash entry for {lesson_id} not found", 404)
        best: tuple[int, Path] | None = None
        for path in trash_dir.iterdir():
            if not path.is_dir():
                continue
            prefix, sep, suffix = path.name.rpartition("__")
            if not sep or prefix != lesson_id:
                continue
            try:
                ts = int(suffix)
            except ValueError:
                ts = int(path.stat().st_mtime)
            if best is None or ts > best[0]:
                best = (ts, path)
        if best is None:
            raise ApiError("not_found", f"trash entry for {lesson_id} not found", 404)
        source = best[1]
        target = self.lesson_dir(lesson_id)
        if target.exists():
            new_id = self._new_suffix_id(lesson_id)
            target = self.lesson_dir(new_id)
            while target.exists():
                new_id = self._new_suffix_id(lesson_id)
                target = self.lesson_dir(new_id)
        else:
            new_id = lesson_id
        source.rename(target)
        meta = self._load_meta(target, new_id)
        if meta.id != new_id:
            meta.id = new_id
        meta.updated_at = now_iso()
        self._write_meta(target, meta)
        self._md_hashes.pop(new_id, None)
        return meta

    def _iter_lesson_dirs(self) -> list[Path]:
        lessons_dir = self.settings.lessons_dir
        if not lessons_dir.is_dir():
            return []
        return sorted(
            path
            for path in lessons_dir.iterdir()
            if path.is_dir() and not path.name.startswith(".")
        )

    def _purge_trash(self) -> None:
        trash_dir = self.settings.lessons_dir / ".trash"
        if not trash_dir.is_dir():
            return
        cutoff = time.time() - self.settings.trash_days * 86_400
        for path in trash_dir.iterdir():
            if not path.is_dir():
                continue
            ts: float
            _, _, suffix = path.name.rpartition("__")
            try:
                ts = float(suffix)
            except ValueError:
                ts = path.stat().st_mtime
            if ts < cutoff:
                shutil.rmtree(path)

    def _clean_title(self, title: str | None) -> str:
        if title is None:
            return "Untitled lesson"
        stripped = title.strip()
        if not stripped or all(ch == "." or ch.isspace() for ch in stripped):
            return "Untitled lesson"
        cleaned = " ".join(stripped.split())
        if len(cleaned) > 120:
            cleaned = cleaned[:120].strip()
        return cleaned or "Untitled lesson"

    def _new_lesson_id(self, title: str) -> str:
        slug = self._slug(title)
        return f"{slug}-{secrets.token_hex(3)}"

    def _new_suffix_id(self, lesson_id: str) -> str:
        token = secrets.token_hex(3)
        if len(lesson_id) + 1 + len(token) <= 64:
            return f"{lesson_id}-{token}"
        base = lesson_id[: 64 - 1 - len(token)].rstrip("-")
        if not base:
            base = lesson_id[0]
        return f"{base}-{token}"

    def _slug(self, title: str) -> str:
        text = title.replace("Đ", "D").replace("đ", "d")
        text = unicodedata.normalize("NFD", text)
        text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
        text = text.lower()
        text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
        text = text[:40].rstrip("-")
        return text or "lesson"

    def _write_lesson_md(self, lesson_dir: Path, title: str) -> None:
        write_atomic(lesson_dir / "lesson.md", f"# {title}\n\n".encode(), backup=False)

    def _write_meta(self, lesson_dir: Path, meta: LessonMeta) -> None:
        raw = json.dumps(meta.model_dump(by_alias=True), ensure_ascii=False, indent=2)
        write_atomic(lesson_dir / "lesson.json", raw.encode("utf-8"), backup=False)

    def _load_meta(self, lesson_dir: Path, lesson_id: str) -> LessonMeta:
        meta_path = lesson_dir / "lesson.json"
        if meta_path.exists():
            try:
                text, _ = read_text_lenient(meta_path)
                data = json.loads(text)
                return LessonMeta.model_validate(data)
            except (json.JSONDecodeError, ValueError):
                self._rename_corrupt(meta_path)
        title_source = self._first_heading(lesson_dir / "lesson.md") or lesson_id
        meta = LessonMeta(
            v=1,
            id=lesson_id,
            title=self._clean_title(title_source),
            created_at=now_iso(),
            updated_at=now_iso(),
        )
        self._write_meta(lesson_dir, meta)
        return meta

    def _rename_corrupt(self, path: Path) -> None:
        ts = int(time.time())
        target = path.with_name(f"{path.name}.corrupt-{ts}")
        while target.exists():
            ts += 1
            target = path.with_name(f"{path.name}.corrupt-{ts}")
        path.rename(target)

    def _first_heading(self, path: Path) -> str | None:
        if not path.exists():
            return None
        text, _ = read_text_lenient(path)
        for line in text.splitlines():
            if line.startswith("# "):
                title = line[2:].strip()
                if title:
                    return title
        return None
