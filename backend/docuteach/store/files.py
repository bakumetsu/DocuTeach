"""Atomic file operations for the DocuTeach store."""

import errno
import hashlib
import os
import shutil
import time
from pathlib import Path

from docuteach.errors import ApiError


def write_atomic(path: Path, data: bytes, *, backup: bool = False) -> None:
    """Atomically write *data* to *path*.

    Writes ``path.tmp`` in the same folder, flushes + fsyncs, optionally backs
    up the current file to ``path.name + ".bak"``, then ``os.replace`` onto the
    target.  Retries 5 times on ``PermissionError`` (Windows file lock) before
    raising ``ApiError("file_busy", …, 503)``.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and not os.access(path, os.W_OK):
        raise ApiError("read_only", "File is read-only", 403)
    tmp = path.with_name(path.name + ".tmp")

    try:
        with open(tmp, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
    except PermissionError:
        raise ApiError("read_only", "Target location is read-only", 403) from None
    except OSError as exc:
        if exc.errno == errno.ENOSPC:
            raise ApiError("disk_full", "Disk is full", 507) from exc
        raise

    if backup and path.exists():
        shutil.copyfile(path, path.with_name(path.name + ".bak"))

    for attempt in range(5):
        try:
            os.replace(str(tmp), str(path))
            return
        except PermissionError:
            if attempt < 4:
                time.sleep(0.05)
            else:
                tmp.unlink(missing_ok=True)
                raise ApiError(
                    "file_busy",
                    "File is locked by another process; please retry",
                    503,
                ) from None
    # Unreachable, but satisfies the type-checker.
    raise ApiError("file_busy", "File is locked by another process; please retry", 503)


def read_text_lenient(path: Path) -> tuple[str, bool]:
    """Read *path* as UTF-8, stripping a BOM.

    Returns ``(text, used_replacement)`` where *used_replacement* is ``True``
    when invalid bytes were decoded with U+FFFD.
    """
    raw = path.read_bytes()
    if raw.startswith(b"\xef\xbb\xbf"):
        raw = raw[3:]
    try:
        return raw.decode("utf-8"), False
    except UnicodeDecodeError:
        return raw.decode("utf-8", errors="replace"), True


def sha256_hex(data: bytes) -> str:
    """Return the hex SHA-256 digest of *data*."""
    return hashlib.sha256(data).hexdigest()


def sweep_tmp(root: Path) -> int:
    """Delete every ``*.tmp`` file under *root* (recursive).  Returns the count removed."""
    if not root.is_dir():
        return 0
    count = 0
    for p in root.rglob("*.tmp"):
        try:
            p.unlink()
            count += 1
        except OSError:
            pass
    return count
