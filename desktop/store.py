"""Desktop store: per-key JSON files with atomic writes and instance locking."""

from __future__ import annotations

import errno
import json
import os
import shutil
import sys
import threading
import time
import urllib.parse
from collections.abc import Callable
from pathlib import Path
from typing import Any

_ENOSPC = errno.ENOSPC


class StoreFull(Exception):
    """Raised when the disk is full (ENOSPC) during a write."""


class Store:
    """Per-key JSON file store with atomic writes and seq-based idempotency."""

    def __init__(self, data_dir: Path) -> None:
        self._data_dir = data_dir
        self._last_seq: dict[str, int] = {}
        self._locks: dict[str, threading.Lock] = {}
        self._meta_lock = threading.Lock()
        self.notices: list[str] = []
        self._replace: Callable[[Path, Path], None] = os.replace

    # ------------------------------------------------------------------
    # public API
    # ------------------------------------------------------------------

    def file_for(self, key: str) -> Path:
        """Return the on-disk path for *key*."""
        return self._data_dir / (urllib.parse.quote(key, safe="") + ".json")

    def load_all(self) -> dict[str, str]:
        """Read every key file at startup.  Returns ``{}`` if folder missing."""
        if not self._data_dir.is_dir():
            return {}
        result: dict[str, str] = {}
        for entry in sorted(self._data_dir.iterdir()):
            name = entry.name
            if name.endswith((".tmp", ".bak")) or ".corrupt" in name:
                continue
            if not name.endswith(".json"):
                continue
            quoted_key = name[: -len(".json")]
            key = urllib.parse.unquote(quoted_key)
            result[key] = self._load_key_file(entry, key)
        return result

    def put(self, key: str, value: str, seq: int) -> str:
        """Store *value* under *key*.  Returns ``"ok"`` or ``"stale"``."""
        with self._get_lock(key):
            if seq <= self._last_seq.get(key, 0):
                return "stale"
            path = self.file_for(key)
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp_path = path.with_name(path.name + ".tmp")
            try:
                with open(tmp_path, "w", encoding="utf-8") as f:
                    f.write(json.dumps({"value": value}))
                    f.flush()
                    os.fsync(f.fileno())
            except OSError as e:
                if e.errno == _ENOSPC:
                    raise StoreFull(str(e)) from e
                raise
            if path.is_file():
                bak_path = path.with_name(path.name + ".bak")
                try:
                    shutil.copy2(path, bak_path)
                except OSError:
                    pass
            try:
                self._replace(tmp_path, path)
            except OSError as e:
                tmp_path.unlink(missing_ok=True)
                if e.errno == _ENOSPC:
                    raise StoreFull(str(e)) from e
                raise
            self._last_seq[key] = seq
            return "ok"

    def delete(self, key: str, seq: int) -> str:
        """Remove the file for *key*.  Returns ``"ok"`` or ``"stale"``."""
        with self._get_lock(key):
            if seq <= self._last_seq.get(key, 0):
                return "stale"
            path = self.file_for(key)
            if path.is_file():
                bak_path = path.with_name(path.name + ".bak")
                try:
                    os.replace(path, bak_path)
                except OSError:
                    pass
            self._last_seq[key] = seq
            return "ok"

    # ------------------------------------------------------------------
    # internal helpers
    # ------------------------------------------------------------------

    def _get_lock(self, key: str) -> threading.Lock:
        with self._meta_lock:
            if key not in self._locks:
                self._locks[key] = threading.Lock()
            return self._locks[key]

    def _load_key_file(self, path: Path, key: str) -> str:
        try:
            raw = path.read_text(encoding="utf-8")
            data = json.loads(raw)
            if not isinstance(data, dict):
                raise TypeError("not a dict")
            value: Any = data.get("value")
            if not isinstance(value, str):
                raise TypeError("'value' not a string")
            return value
        except (OSError, json.JSONDecodeError, ValueError, TypeError, UnicodeDecodeError):
            ts = time.strftime("%Y%m%dT%H%M%S")
            corrupt_path = path.with_name(f"{path.name}.corrupt-{ts}")
            try:
                os.replace(path, corrupt_path)
            except OSError:
                pass
            self.notices.append(f"key {key!r}: file corrupt, attempting backup")
            bak_path = path.with_name(path.name + ".bak")
            if bak_path.is_file():
                try:
                    raw = bak_path.read_text(encoding="utf-8")
                    data = json.loads(raw)
                    value: Any = data.get("value")
                    if isinstance(value, str):
                        return value
                except (OSError, json.JSONDecodeError, UnicodeDecodeError, TypeError):
                    pass
            self.notices.append(f"key {key!r}: no valid backup, value empty")
            return ""


class InstanceLock:
    """OS-level single-instance file lock (msvcrt on Windows, fcntl elsewhere)."""

    def __init__(self, path: Path) -> None:
        self._path = path
        self._file: Any = None  # BinaryIO | None

    def acquire(self) -> bool:
        """Attempt to acquire the lock.  Returns True on success."""
        if self._file is not None:
            return True
        f: Any = None
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            f = open(self._path, "a+b")  # noqa: SIM115 - held for the lock lifetime
            if sys.platform == "win32":
                import msvcrt  # type: ignore[import-untyped]

                f.seek(0)
                msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl  # type: ignore[import-untyped]

                fcntl.flock(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            self._file = f
            return True
        except OSError:
            if f is not None:
                try:
                    f.close()
                except OSError:
                    pass
            self._file = None
            return False

    def release(self) -> None:
        """Release the lock (if held) and close the file."""
        if self._file is None:
            return
        f = self._file
        self._file = None
        try:
            if sys.platform == "win32":
                import msvcrt  # type: ignore[import-untyped]

                f.seek(0)
                msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl  # type: ignore[import-untyped]

                fcntl.flock(f.fileno(), fcntl.LOCK_UN)
        except OSError:
            pass
        try:
            f.close()
        except OSError:
            pass
