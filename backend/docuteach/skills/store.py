"""Skill folder: read built-ins and user skill files."""

from __future__ import annotations

import importlib.resources
import json
from dataclasses import dataclass
from pathlib import Path
from typing import cast

from docuteach.skills.format import COMMAND_RE, SkillFormatError, SkillSpec, parse_skill

_BUILTIN_NAMES: tuple[str, ...] = ("ccq.md", "drills.md", "pitfalls.md")


@dataclass(frozen=True)
class FileResult:
    slug: str
    spec: SkillSpec | None
    error: SkillFormatError | None


class SkillFolder:
    def __init__(self, user_dir: Path) -> None:
        self._user_dir = user_dir
        self._cache: dict[Path, tuple[int, int, FileResult]] = {}

    # -- built-ins ----------------------------------------------------------

    def read_builtins(self) -> list[FileResult]:
        results: list[FileResult] = []
        pkg = importlib.resources.files("docuteach.skills.builtin")
        for name in _BUILTIN_NAMES:
            slug = name.removesuffix(".md")
            try:
                raw = (pkg / name).read_bytes()
            except OSError:
                results.append(
                    FileResult(
                        slug=slug,
                        spec=None,
                        error=SkillFormatError("unreadable", "The file could not be read."),
                    )
                )
                continue
            try:
                spec = parse_skill(raw)
            except SkillFormatError as exc:
                results.append(FileResult(slug=slug, spec=None, error=exc))
            else:
                results.append(FileResult(slug=slug, spec=spec, error=None))
        return results

    # -- user files ----------------------------------------------------------

    def read_user(self) -> list[FileResult]:
        if not self._user_dir.is_dir():
            self._cache.clear()
            return []

        files: list[Path] = sorted(
            p
            for p in self._user_dir.iterdir()
            if p.is_file()
            and p.suffix == ".md"
            and not p.name.startswith("_")
            and not p.name.startswith(".")
        )

        seen: set[Path] = set()
        results: list[FileResult] = []

        for path in files:
            seen.add(path)
            slug = path.stem

            try:
                st = path.stat()
            except OSError:
                results.append(
                    FileResult(
                        slug=slug,
                        spec=None,
                        error=SkillFormatError("unreadable", "The file could not be read."),
                    )
                )
                continue

            key = (st.st_mtime_ns, st.st_size)
            cached = self._cache.get(path)
            if cached is not None and cached[0] == key[0] and cached[1] == key[1]:
                results.append(cached[2])
                continue

            try:
                raw = path.read_bytes()
            except OSError:
                result = FileResult(
                    slug=slug,
                    spec=None,
                    error=SkillFormatError("unreadable", "The file could not be read."),
                )
                self._cache[path] = (*key, result)
                results.append(result)
                continue

            try:
                spec = parse_skill(raw)
            except SkillFormatError as exc:
                result = FileResult(slug=slug, spec=None, error=exc)
            else:
                if spec.command.lstrip("/") != slug:
                    result = FileResult(
                        slug=slug,
                        spec=None,
                        error=SkillFormatError(
                            "bad_command", "The file name must match the command"
                        ),
                    )
                else:
                    result = FileResult(slug=slug, spec=spec, error=None)

            self._cache[path] = (*key, result)
            results.append(result)

        # Drop cache entries for files that vanished.
        stale = [p for p in self._cache if p not in seen]
        for p in stale:
            del self._cache[p]

        return results

    # -- hidden list ---------------------------------------------------------

    def hidden(self) -> frozenset[str]:
        state_path = self._user_dir / "_state.json"
        try:
            raw = state_path.read_bytes()
            data: object = json.loads(raw)
        except (OSError, json.JSONDecodeError, UnicodeDecodeError):
            return frozenset()

        if not isinstance(data, dict):
            return frozenset()
        hidden_raw = cast("dict[str, object]", data).get("hidden")
        if not isinstance(hidden_raw, list):
            return frozenset()

        items = cast("list[object]", hidden_raw)
        return frozenset(s for s in items if isinstance(s, str) and COMMAND_RE.match(s))
