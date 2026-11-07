"""Checkpoint CRUD and pruning logic (operates on a lesson directory)."""

from __future__ import annotations

import re
import secrets
import threading
from datetime import UTC, datetime, timedelta
from pathlib import Path

from docuteach.config import Settings
from docuteach.errors import ApiError
from docuteach.store import models
from docuteach.store.files import read_text_lenient, write_atomic

_CP_DIRNAME = "checkpoints"
_DELETED_DIRNAME = "_deleted"
_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

_last_ts: datetime | None = None
_lock = threading.Lock()


def _new_id() -> str:
    """Generate a checkpoint id: ``<UTC YYYYMMDDTHHMMSSffffff>-<4 hex>``.

    Guarantees strictly increasing timestamps within the process (avoids
    same-microsecond ties on coarse Windows clocks).
    """
    global _last_ts
    with _lock:
        now = datetime.now(UTC)
        if _last_ts is not None and now <= _last_ts:
            now = _last_ts + timedelta(microseconds=1)
        _last_ts = now
    ts = now.strftime("%Y%m%dT%H%M%S%f")
    return f"{ts}-{secrets.token_hex(2)}"


def _cp_dir(lesson_dir: Path) -> Path:
    return lesson_dir / _CP_DIRNAME


def _deleted_dir(lesson_dir: Path) -> Path:
    return _cp_dir(lesson_dir) / _DELETED_DIRNAME


def _load_meta(json_path: Path) -> models.CheckpointMeta:
    return models.CheckpointMeta.model_validate_json(json_path.read_bytes())


def _load_checkpoint(json_path: Path, md_path: Path) -> models.Checkpoint | None:
    if not md_path.exists():
        return None
    meta = _load_meta(json_path)
    markdown, _ = read_text_lenient(md_path)
    return models.Checkpoint(
        id=meta.id,
        name=meta.name,
        created_at=meta.created_at,
        markdown=markdown,
        auto=meta.auto,
    )


def list_checkpoints(lesson_dir: Path) -> list[models.Checkpoint]:
    """Return all committed checkpoints, newest first.

    Orphan ``.md`` files (no ``.json``) are ignored.
    """
    cp = _cp_dir(lesson_dir)
    if not cp.is_dir():
        return []
    results: list[models.Checkpoint] = []
    for json_path in cp.glob("*.json"):
        cp_instance = _load_checkpoint(json_path, json_path.with_suffix(".md"))
        if cp_instance is not None:
            results.append(cp_instance)
    results.sort(key=lambda c: c.id, reverse=True)
    return results


def create_checkpoint(
    lesson_dir: Path,
    settings: Settings,
    name: str,
    markdown: str,
    auto: bool = False,
) -> models.Checkpoint:
    """Create a new checkpoint (``.md`` first, ``.json`` as commit marker) and prune if over cap."""
    cp = _cp_dir(lesson_dir)
    cp.mkdir(parents=True, exist_ok=True)

    cid = _new_id()
    meta = models.CheckpointMeta(id=cid, name=name, created_at=models.now_iso(), auto=auto)

    write_atomic(cp / f"{cid}.md", markdown.encode("utf-8"))
    write_atomic(cp / f"{cid}.json", meta.model_dump_json(by_alias=True).encode("utf-8"))

    _prune(lesson_dir, settings)

    return models.Checkpoint(
        id=cid, name=name, created_at=meta.created_at, markdown=markdown, auto=auto
    )


def remove_checkpoint(lesson_dir: Path, checkpoint_id: str) -> None:
    """Move a checkpoint to ``checkpoints/_deleted``.  Raises 404 if missing."""
    if not _ID_RE.match(checkpoint_id):
        raise ApiError("bad_id", "Invalid checkpoint id", 400)
    cp = _cp_dir(lesson_dir)
    json_path = cp / f"{checkpoint_id}.json"
    if not json_path.exists():
        raise ApiError("not_found", "Checkpoint not found", 404)
    _move_to_deleted(lesson_dir, checkpoint_id)


def restore_checkpoint(lesson_dir: Path, checkpoint_id: str) -> models.Checkpoint:
    """Move a checkpoint back from ``_deleted``.  Raises 404 if missing."""
    if not _ID_RE.match(checkpoint_id):
        raise ApiError("bad_id", "Invalid checkpoint id", 400)
    cp = _cp_dir(lesson_dir)
    deleted = _deleted_dir(lesson_dir)
    json_path = deleted / f"{checkpoint_id}.json"
    if not json_path.exists():
        raise ApiError("not_found", "Checkpoint not found in deleted", 404)

    meta = _load_meta(json_path)
    md_path = deleted / f"{checkpoint_id}.md"
    markdown = ""
    if md_path.exists():
        markdown, _ = read_text_lenient(md_path)

    json_path.rename(cp / f"{checkpoint_id}.json")
    if md_path.exists():
        md_path.rename(cp / f"{checkpoint_id}.md")

    return models.Checkpoint(
        id=meta.id, name=meta.name, created_at=meta.created_at, markdown=markdown, auto=meta.auto
    )


def sweep_orphans(lesson_dir: Path) -> int:
    """Delete ``.md`` files in ``checkpoints/`` that have no matching ``.json``.  Returns count."""
    cp = _cp_dir(lesson_dir)
    if not cp.is_dir():
        return 0
    count = 0
    for md_path in cp.glob("*.md"):
        if not md_path.with_suffix(".json").exists():
            md_path.unlink(missing_ok=True)
            count += 1
    return count


# ── internal helpers ──────────────────────────────────────────────────────────


def _move_to_deleted(lesson_dir: Path, cid: str) -> None:
    cp = _cp_dir(lesson_dir)
    deleted = _deleted_dir(lesson_dir)
    deleted.mkdir(parents=True, exist_ok=True)
    for ext in (".md", ".json"):
        src = cp / f"{cid}{ext}"
        if src.exists():
            src.rename(deleted / f"{cid}{ext}")


def _prune(lesson_dir: Path, settings: Settings) -> None:
    """Move the oldest over-cap checkpoint to ``_deleted``.

    The newest auto checkpoint named "Before open" is never pruned.
    """
    cps = list_checkpoints(lesson_dir)
    manual = [c for c in cps if not c.auto]
    auto = [c for c in cps if c.auto]

    # Newest "Before open" auto (first in list, which is newest-first)
    exempt_id: str | None = None
    for c in auto:
        if c.name == "Before open":
            exempt_id = c.id
            break

    if len(manual) > settings.checkpoint_cap:
        for c in reversed(manual):  # oldest first
            if c.id != exempt_id:
                _move_to_deleted(lesson_dir, c.id)
                break

    if len(auto) > settings.auto_checkpoint_cap:
        for c in reversed(auto):  # oldest first
            if c.id != exempt_id:
                _move_to_deleted(lesson_dir, c.id)
                break
