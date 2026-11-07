"""Skill management: create, import, delete, restore, and export user skills."""

from __future__ import annotations

import logging
import os
import re
import threading
import time
from collections.abc import Mapping
from pathlib import Path
from typing import cast

from docuteach.errors import ApiError
from docuteach.skills.format import (
    COMMAND_RE,
    MAX_FILE_BYTES,
    SkillFormatError,
    SkillSpec,
    parse_skill,
)
from docuteach.skills.store import FileResult, SkillFolder
from docuteach.store.files import write_atomic

logger = logging.getLogger("docuteach")


# -- module-level helpers ------------------------------------------------------


def serialize_skill(spec: SkillSpec) -> bytes:
    parts: list[str] = [
        "---",
        f"command: {spec.command}",
        f"name: {spec.name}",
        f"description: {spec.description}",
        f"insertAs: {spec.insert_as}",
    ]
    if spec.insert_as == "teacherNote":
        parts.append(f"tag: {spec.tag}")
    parts.append("---")
    parts.append(spec.body)
    return ("\n".join(parts) + "\n").encode("utf-8")


def build_spec(fields: Mapping[str, object]) -> SkillSpec:
    # Extract and validate required string fields
    command = _get_str(fields, "command")
    name = _get_str(fields, "name")
    description = _get_str(fields, "description")
    insert_as = _get_str(fields, "insertAs")
    body = _get_str(fields, "body")

    # tag is optional
    tag_raw = fields.get("tag")
    tag: str | None = None
    if tag_raw is not None:
        if not isinstance(tag_raw, str):
            raise ApiError("bad_field", "Field 'tag' must be a string.", 422)
        tag = tag_raw.strip()
        if not tag:
            tag = None

    command = command.strip()
    name = name.strip()
    description = description.strip()

    # Reject newlines in any header value
    for label, val in (
        ("command", command),
        ("name", name),
        ("description", description),
        ("insertAs", insert_as),
    ):
        if "\n" in val or "\r" in val:
            raise ApiError(
                "bad_header", f"Header value for '{label}' must not contain newlines.", 422
            )
    if tag is not None and ("\n" in tag or "\r" in tag):
        raise ApiError("bad_header", "Header value for 'tag' must not contain newlines.", 422)

    # Build serialise-style text and run through parse_skill
    parts: list[str] = [
        "---",
        f"command: {command}",
        f"name: {name}",
        f"description: {description}",
        f"insertAs: {insert_as}",
    ]
    if tag is not None:
        parts.append(f"tag: {tag}")
    parts.append("---")
    parts.append(body)
    raw = "\n".join(parts).encode("utf-8")

    try:
        return parse_skill(raw)
    except SkillFormatError as exc:
        raise ApiError(exc.code, exc.reason, 422) from exc


def _get_str(fields: Mapping[str, object], key: str) -> str:
    val = fields.get(key)
    if not isinstance(val, str):
        raise ApiError("bad_field", f"Field '{key}' must be a string.", 422)
    return val


# -- SkillManager --------------------------------------------------------------


class SkillManager:
    def __init__(self, user_dir: Path, trash_days: int) -> None:
        self._dir = user_dir
        self._folder = SkillFolder(user_dir)
        self._lock = threading.RLock()
        self._trash_days = trash_days
        self._purge_trash()

    # -- public methods --------------------------------------------------------

    def list_all(self) -> list[dict[str, object]]:
        with self._lock:
            self._purge_trash()
            builtins = self._folder.read_builtins()
            user_files = self._folder.read_user()
            hidden = self._hidden()

            # Index user files by slug
            user_by_slug: dict[str, FileResult] = {}
            for r in user_files:
                user_by_slug[r.slug] = r

            # Built-in slugs and order (valid only)
            builtin_slugs_set: set[str] = set()
            builtin_order: list[str] = []
            builtin_spec_by_slug: dict[str, SkillSpec] = {}
            for r in builtins:
                if r.spec is not None:
                    builtin_slugs_set.add(r.slug)
                    builtin_order.append(r.slug)
                    builtin_spec_by_slug[r.slug] = r.spec

            items: list[dict[str, object]] = []

            # Section 1: built-ins in order
            for slug in builtin_order:
                spec = builtin_spec_by_slug[slug]
                command = "/" + slug
                user_result = user_by_slug.get(slug)
                if user_result is not None and user_result.spec is not None:
                    us = user_result.spec
                    items.append(
                        {
                            "command": us.command,
                            "name": us.name,
                            "description": us.description,
                            "insertAs": us.insert_as,
                            "tag": us.tag,
                            "body": us.body,
                            "source": "customized",
                            "hidden": us.command in hidden,
                            "reason": "",
                            "code": "",
                        }
                    )
                else:
                    items.append(
                        {
                            "command": command,
                            "name": spec.name,
                            "description": spec.description,
                            "insertAs": spec.insert_as,
                            "tag": spec.tag,
                            "body": spec.body,
                            "source": "builtin",
                            "hidden": command in hidden,
                            "reason": "",
                            "code": "",
                        }
                    )

            # Section 2: user files
            for r in user_files:
                if r.slug in builtin_slugs_set:
                    # Only broken user files for built-in slugs appear here
                    if r.spec is None and r.error is not None:
                        items.append(
                            {
                                "command": "/" + r.slug,
                                "name": r.slug,
                                "description": "",
                                "insertAs": "",
                                "tag": "",
                                "body": "",
                                "source": "broken",
                                "hidden": False,
                                "reason": r.error.reason,
                                "code": r.error.code,
                            }
                        )
                else:
                    if r.spec is not None:
                        spec = r.spec
                        items.append(
                            {
                                "command": spec.command,
                                "name": spec.name,
                                "description": spec.description,
                                "insertAs": spec.insert_as,
                                "tag": spec.tag,
                                "body": spec.body,
                                "source": "custom",
                                "hidden": False,
                                "reason": "",
                                "code": "",
                            }
                        )
                    elif r.error is not None:
                        items.append(
                            {
                                "command": "/" + r.slug,
                                "name": r.slug,
                                "description": "",
                                "insertAs": "",
                                "tag": "",
                                "body": "",
                                "source": "broken",
                                "hidden": False,
                                "reason": r.error.reason,
                                "code": r.error.code,
                            }
                        )

            return items

    def save(self, fields: Mapping[str, object], replace: bool) -> dict[str, object]:
        with self._lock:
            spec = build_spec(fields)
            slug = spec.command.lstrip("/")
            path = self._dir / f"{slug}.md"

            builtin_slugs = self._builtin_slugs()
            exists = path.exists() or slug in builtin_slugs
            if exists and not replace:
                raise ApiError("skill_exists", f"Skill '{spec.command}' already exists.", 409)

            write_atomic(path, serialize_skill(spec), backup=True)

            # Unhide if hidden
            hidden = self._hidden()
            if spec.command in hidden:
                hidden.discard(spec.command)
                self._write_hidden(hidden)

            logger.info("save command=%s", spec.command)

            return self._find_item(spec.command)

    def import_preview(self, text: str) -> dict[str, object]:
        with self._lock:
            spec = self._parse_text(text)
            slug = spec.command.lstrip("/")
            user_path = self._dir / f"{slug}.md"
            builtin_slugs = self._builtin_slugs()

            if user_path.exists():
                clash: str | None = "custom"
            elif slug in builtin_slugs:
                clash = "builtin"
            else:
                clash = None

            return {
                "skill": {
                    "command": spec.command,
                    "name": spec.name,
                    "description": spec.description,
                    "insertAs": spec.insert_as,
                    "tag": spec.tag,
                    "body": spec.body,
                },
                "warnings": [],
                "clash": clash,
            }

    def import_commit(
        self, text: str, on_clash: str | None, command: str | None
    ) -> dict[str, object]:
        with self._lock:
            spec = self._parse_text(text)
            slug = spec.command.lstrip("/")
            user_path = self._dir / f"{slug}.md"
            builtin_slugs = self._builtin_slugs()

            if user_path.exists():
                clash: str | None = "custom"
            elif slug in builtin_slugs:
                clash = "builtin"
            else:
                clash = None

            new_command: str | None = None
            if clash is None:
                write_atomic(user_path, serialize_skill(spec), backup=True)
                logger.info("import_commit command=%s", spec.command)
            elif on_clash == "replace":
                write_atomic(user_path, serialize_skill(spec), backup=True)
                hidden = self._hidden()
                if spec.command in hidden:
                    hidden.discard(spec.command)
                    self._write_hidden(hidden)
                logger.info("import_commit command=%s (replace)", spec.command)
            elif on_clash == "rename":
                if (
                    not isinstance(command, str)
                    or not COMMAND_RE.match(command)
                    or command == spec.command
                ):
                    raise ApiError(
                        "skill_exists",
                        "Rename target must be a valid command different from the original.",
                        409,
                    )
                new_command = command
                new_slug = command.lstrip("/")
                new_path = self._dir / f"{new_slug}.md"
                if new_path.exists() or new_slug in builtin_slugs:
                    raise ApiError("skill_exists", f"Skill '{command}' already exists.", 409)
                renamed_fields: dict[str, object] = {
                    "command": command,
                    "name": spec.name,
                    "description": spec.description,
                    "insertAs": spec.insert_as,
                    "body": spec.body,
                }
                if spec.insert_as == "teacherNote":
                    renamed_fields["tag"] = spec.tag
                renamed_spec = build_spec(renamed_fields)
                write_atomic(new_path, serialize_skill(renamed_spec), backup=True)
                logger.info("import_commit rename to=%s", command)
            else:
                raise ApiError("skill_exists", "Skill already exists; use replace or rename.", 409)

            target_cmd = new_command or spec.command
            return self._find_item(target_cmd)

    def delete(self, slug: str) -> str:
        with self._lock:
            self._check_slug(slug)
            user_path = self._dir / f"{slug}.md"
            builtin_slugs = self._builtin_slugs()

            if user_path.exists():
                trash_id = self._trash(slug)
                logger.info("delete slug=%s", slug)
                return trash_id

            if slug in builtin_slugs:
                command = "/" + slug
                hidden = self._hidden()
                if command in hidden:
                    raise ApiError("not_found", f"Skill '{command}' is already hidden.", 404)
                hidden.add(command)
                self._write_hidden(hidden)
                logger.info("delete hide slug=%s", slug)
                return f"hide__{slug}"

            raise ApiError("not_found", f"Skill '{slug}' not found.", 404)

    def restore_trash(self, trash_id: str) -> dict[str, object]:
        with self._lock:
            # hide__<slug>
            m = re.match(r"^hide__([a-z][a-z0-9-]{1,23})$", trash_id)
            if m:
                slug = m.group(1)
                command = "/" + slug
                hidden = self._hidden()
                if command not in hidden:
                    raise ApiError("not_found", f"Skill '{command}' is not hidden.", 404)
                hidden.discard(command)
                self._write_hidden(hidden)
                logger.info("restore_trash unhide slug=%s", slug)
                return self._find_item(command)

            # <slug>__<ts>
            m2 = re.match(r"^([^/\\.][^/\\]*)__(\d+)$", trash_id)
            if not m2:
                raise ApiError("bad_trash_id", f"Invalid trash id '{trash_id}'.", 400)

            slug = m2.group(1)
            self._check_slug(slug)
            trash_file = self._dir / ".trash" / f"{trash_id}.md"
            if not trash_file.exists():
                raise ApiError("not_found", f"Trash entry '{trash_id}' not found.", 404)

            target = self._dir / f"{slug}.md"
            if target.exists():
                raise ApiError("skill_exists", f"Skill '{slug}' already exists.", 409)

            try:
                os.replace(str(trash_file), str(target))
            except OSError as exc:
                raise ApiError("write_failed", "Could not restore the skill file.", 500) from exc

            logger.info("restore_trash slug=%s", slug)
            return self._find_item("/" + slug)

    def reset(self, slug: str) -> str:
        with self._lock:
            self._check_command_slug(slug)
            builtin_slugs = self._builtin_slugs()
            if slug not in builtin_slugs:
                raise ApiError("not_builtin", f"'{slug}' is not a built-in skill.", 409)
            user_path = self._dir / f"{slug}.md"
            if not user_path.exists():
                raise ApiError("not_customized", f"'{slug}' has no custom override.", 409)
            trash_id = self._trash(slug)
            logger.info("reset slug=%s", slug)
            return trash_id

    def restore_defaults(self) -> None:
        with self._lock:
            state_path = self._dir / "_state.json"
            try:
                raw = state_path.read_bytes()
            except OSError:
                return
            import json

            try:
                data: object = json.loads(raw)
            except (json.JSONDecodeError, UnicodeDecodeError):
                return
            if not isinstance(data, dict):
                return
            d = cast("dict[str, object]", data)
            hidden_raw = d.get("hidden")
            if not isinstance(hidden_raw, list) or not hidden_raw:
                return
            d["hidden"] = []
            try:
                write_atomic(state_path, json.dumps(d, indent=2).encode("utf-8"))
            except OSError as exc:
                raise ApiError("write_failed", "Could not write state file.", 500) from exc

    def export_file(self, slug: str) -> tuple[str, bytes]:
        with self._lock:
            self._check_slug(slug)
            builtin_slugs = self._builtin_slugs()
            user_path = self._dir / f"{slug}.md"

            # Try user file first
            if user_path.exists():
                try:
                    raw = user_path.read_bytes()
                except OSError as exc:
                    raise ApiError("not_found", f"Skill '{slug}' could not be read.", 404) from exc
                try:
                    spec = parse_skill(raw)
                except SkillFormatError:
                    raise ApiError("broken", f"Skill '{slug}' is broken.", 409) from None
                if spec.command.lstrip("/") != slug:
                    raise ApiError("broken", f"Skill '{slug}' is broken.", 409) from None
                return (f"{slug}.md", serialize_skill(spec))

            # Fall back to built-in
            if slug in builtin_slugs:
                for r in self._folder.read_builtins():
                    if r.slug == slug and r.spec is not None:
                        return (f"{slug}.md", serialize_skill(r.spec))

            raise ApiError("not_found", f"Skill '{slug}' not found.", 404)

    # -- private helpers -------------------------------------------------------

    def _builtin_slugs(self) -> set[str]:
        return {r.slug for r in self._folder.read_builtins() if r.spec is not None}

    def _hidden(self) -> set[str]:
        return set(self._folder.hidden())

    def _write_hidden(self, hidden: set[str]) -> None:
        state_path = self._dir / "_state.json"
        import json

        data: dict[str, object] = {}
        try:
            raw = state_path.read_bytes()
            parsed: object = json.loads(raw)
            if isinstance(parsed, dict):
                data = cast("dict[str, object]", parsed)
        except (OSError, json.JSONDecodeError, UnicodeDecodeError):
            pass
        data["hidden"] = sorted(hidden)
        try:
            write_atomic(state_path, json.dumps(data, indent=2).encode("utf-8"))
        except OSError as exc:
            raise ApiError("write_failed", "Could not write the skill file.", 500) from exc

    def _trash(self, slug: str) -> str:
        user_path = self._dir / f"{slug}.md"
        trash_dir = self._dir / ".trash"
        trash_dir.mkdir(parents=True, exist_ok=True)
        ts = int(time.time())
        while (trash_dir / f"{slug}__{ts}.md").exists():
            ts += 1
        trash_id = f"{slug}__{ts}"
        trash_path = trash_dir / f"{trash_id}.md"
        try:
            os.replace(str(user_path), str(trash_path))
        except OSError as exc:
            raise ApiError("write_failed", "Could not write the skill file.", 500) from exc
        return trash_id

    def _purge_trash(self) -> None:
        trash_dir = self._dir / ".trash"
        if not trash_dir.is_dir():
            return
        cutoff = time.time() - self._trash_days * 86400
        for f in trash_dir.iterdir():
            if f.is_file() and f.suffix == ".md":
                try:
                    if f.stat().st_mtime < cutoff:
                        f.unlink()
                except OSError:
                    pass

    def _find_item(self, command: str) -> dict[str, object]:
        for item in self.list_all():
            if item["command"] == command:
                return item
        raise ApiError("not_found", f"Skill '{command}' not found.", 404)

    def _parse_text(self, text: object) -> SkillSpec:
        if not isinstance(text, str):
            raise ApiError("bad_field", "Skill text must be a string.", 422)
        try:
            raw = text.encode("utf-8")
        except UnicodeEncodeError:
            raise ApiError("bad_encoding", "Skill text is not valid UTF-8.", 422) from None
        if len(raw) > MAX_FILE_BYTES:
            raise ApiError("too_long", "Skill file exceeds maximum size.", 413)
        try:
            return parse_skill(raw)
        except SkillFormatError as exc:
            raise ApiError(exc.code, exc.reason, 422) from exc

    def _check_slug(self, slug: str) -> None:
        if not slug or "/" in slug or "\\" in slug or ".." in slug:
            raise ApiError("bad_slug", f"Invalid slug '{slug}'.", 400)
        if slug.startswith((".", "_")) or Path(slug).name != slug:
            raise ApiError("bad_slug", f"Invalid slug '{slug}'.", 400)

    def _check_command_slug(self, slug: str) -> None:
        if not re.match(r"^[a-z][a-z0-9-]{1,23}$", slug):
            raise ApiError("bad_slug", f"Invalid slug '{slug}'.", 400)
