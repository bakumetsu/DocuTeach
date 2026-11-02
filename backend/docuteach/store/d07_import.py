"""One-time import of the D-07 store (section 5.1)."""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any, cast

from ..config import Settings
from .files import write_atomic
from .models import CheckpointMeta, LessonMeta, now_iso

log = logging.getLogger("docuteach")

_CKPT_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_DOC_KEY = "docuteach%3Av1%3Adoc%3Adraft.json"
_CKPT_KEY = "docuteach%3Av1%3Ackpt%3Adraft.json"
_CHATS_KEY = "docuteach%3Av1%3Achats%3Adraft.json"
_LESSON_ID = "imported-lesson-d07"
_MARKER = ".imported-d07"
_REPORT = "import_report.txt"


def import_d07(settings: Settings) -> None:
    lessons_dir = settings.lessons_dir
    data_dir = settings.d07_data_dir
    marker = lessons_dir / _MARKER

    if marker.exists():
        return
    doc_path = data_dir / _DOC_KEY
    if not doc_path.exists():
        return

    lessons_dir.mkdir(parents=True, exist_ok=True)
    lesson_dir = lessons_dir / _LESSON_ID

    report: list[str] = []
    now = now_iso()

    # doc (required to proceed)
    doc_md = ""
    doc_updated = now
    try:
        raw_doc = _parse_key(doc_path)
        assert isinstance(raw_doc, dict)
        doc: dict[str, Any] = cast(dict[str, Any], raw_doc)
        doc_md = str(doc.get("markdown", ""))
        doc_updated = str(doc.get("updatedAt", now))
    except Exception as exc:
        report.append(f"doc: {exc}")
        log.warning("d07 import: doc key unreadable: %s", exc)
        write_atomic(lessons_dir / _REPORT, "\n".join(report).encode("utf-8"))
        return

    lesson_dir.mkdir(parents=True, exist_ok=True)
    write_atomic(lesson_dir / "lesson.md", doc_md.encode("utf-8"))
    meta = LessonMeta(
        v=1,
        id=_LESSON_ID,
        title=_extract_title(doc_md),
        created_at=now,
        updated_at=doc_updated,
    )
    write_atomic(lesson_dir / "lesson.json", meta.model_dump_json(by_alias=True).encode("utf-8"))

    # checkpoints
    ckpts_dir = lesson_dir / "checkpoints"
    ckpts_dir.mkdir(parents=True, exist_ok=True)
    try:
        raw_ckpts = _parse_key(data_dir / _CKPT_KEY)
        assert isinstance(raw_ckpts, list)
        ckpts: list[Any] = cast(list[Any], raw_ckpts)
        for raw_cp in ckpts:
            assert isinstance(raw_cp, dict)
            cp: dict[str, Any] = cast(dict[str, Any], raw_cp)
            cp_id = str(cp["id"])
            if not _CKPT_ID_RE.match(cp_id):
                report.append(f"ckpt: skipped invalid id {cp_id!r}")
                continue
            write_atomic(
                ckpts_dir / f"{cp_id}.md",
                str(cp.get("markdown", "")).encode("utf-8"),
            )
            cp_meta = CheckpointMeta(
                id=cp_id,
                name=str(cp["name"]),
                created_at=str(cp["createdAt"]),
                auto=(str(cp["name"]) == "Before open"),
            )
            write_atomic(
                ckpts_dir / f"{cp_id}.json",
                cp_meta.model_dump_json(by_alias=True).encode("utf-8"),
            )
    except Exception as exc:
        report.append(f"ckpts: {exc}")
        log.warning("d07 import: checkpoints key unreadable: %s", exc)

    # chats
    try:
        raw_chats = _parse_key(data_dir / _CHATS_KEY)
        assert isinstance(raw_chats, list)
        chats: list[Any] = cast(list[Any], raw_chats)
        write_atomic(
            lesson_dir / "chats.json",
            json.dumps(chats, ensure_ascii=False).encode("utf-8"),
        )
    except Exception as exc:
        report.append(f"chats: {exc}")
        log.warning("d07 import: chats key unreadable: %s", exc)

    # report + marker (marker written last)
    if report:
        write_atomic(lessons_dir / _REPORT, "\n".join(report).encode("utf-8"))
    write_atomic(marker, now.encode("utf-8"))


def _parse_key(path: Path) -> Any:
    """Parse a D-07 key file: outer JSON {"value": str}, inner string is JSON."""
    raw = path.read_text(encoding="utf-8").strip()
    outer: dict[str, Any] = json.loads(raw)
    return json.loads(str(outer["value"]))


def _extract_title(markdown: str) -> str:
    for line in markdown.splitlines():
        stripped = line.strip()
        if stripped.startswith("# "):
            return stripped[2:].strip()
    return "My lesson"
