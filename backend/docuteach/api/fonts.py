"""Fonts endpoint: open the bundled fonts folder in the OS file manager."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import anyio
from fastapi import APIRouter

from docuteach.errors import ApiError
from docuteach.export.fonts import FONTS_DIR

router = APIRouter()


def open_folder(path: Path) -> None:
    """Open *path* in the platform file manager."""
    if sys.platform == "win32":
        os.startfile(str(path))  # type: ignore[attr-defined]
    elif sys.platform == "darwin":
        subprocess.Popen(["open", str(path)])
    else:
        subprocess.Popen(["xdg-open", str(path)])


@router.post("/fonts/open")
async def fonts_open() -> dict[str, bool]:
    try:
        await anyio.to_thread.run_sync(open_folder, FONTS_DIR)
    except OSError as exc:
        raise ApiError("fonts_open_failed", "Could not open the fonts folder", 500) from exc
    return {"opened": True}
