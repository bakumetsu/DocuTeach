"""PyInstaller spec for DocuTeach desktop (one-folder, windowed, no UPX)."""

import os
from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules
from PyInstaller.utils.win32.versioninfo import (
    FixedFileInfo,
    StringFileInfo,
    StringStruct,
    StringTable,
    VarFileInfo,
    VarStruct,
    VSVersionInfo,
)

spec_dir = Path(SPECPATH)  # type: ignore[name-defined]
repo_root = spec_dir.parent
frontend_dist = repo_root / "frontend" / "dist"
icon_path = spec_dir / "assets" / "icon.ico"
launcher = spec_dir / "launcher.py"

version_str = os.environ.get("DOCUTEACH_VERSION", "0.0.0")
commit_str = os.environ.get("DOCUTEACH_COMMIT", "dev")

major, minor, patch = (int(x) if x.isdigit() else 0 for x in version_str.split(".")[:3])

webview_hidden = collect_submodules(
    "webview",
    filter=lambda n: not any(x in n for x in ("android", "cocoa", "gtk", "qt", "cef")),
)
backend_hidden = collect_submodules("docuteach") + collect_submodules("uvicorn") + ["anyio._backends._asyncio"]

version_info = VSVersionInfo(
    ffi=FixedFileInfo(
        filevers=(major, minor, patch, 0),
        prodvers=(major, minor, patch, 0),
        mask=0x3F,
        flags=0x0,
        OS=0x40004,
        fileType=0x1,
        subtype=0x0,
        date=(0, 0),
    ),
    kids=[
        StringFileInfo(
            [
                StringTable(
                    "040904B0",
                    [
                        StringStruct("CompanyName", "DocuTeach"),
                        StringStruct("FileDescription", "DocuTeach Desktop"),
                        StringStruct("FileVersion", version_str),
                        StringStruct("InternalName", "DocuTeach"),
                        StringStruct("LegalCopyright", "MIT"),
                        StringStruct("OriginalFilename", "DocuTeach.exe"),
                        StringStruct("ProductName", "DocuTeach"),
                        StringStruct("ProductVersion", version_str),
                        StringStruct("Comments", "build " + commit_str),
                    ],
                )
            ]
        ),
        VarFileInfo([VarStruct("Translation", [1033, 1200])]),
    ],
)

a = Analysis(
    [str(launcher)],
    pathex=[str(spec_dir), str(repo_root / "backend")],
    datas=[(str(frontend_dist), "web")],
    hiddenimports=webview_hidden + backend_hidden,
    excludes=["tkinter", "tkinter.test", "test"],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    [],
    exclude_binaries=True,
    name="DocuTeach",
    debug=False,
    strip=False,
    upx=False,
    console=False,
    icon=str(icon_path),
    version_info=version_info,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="DocuTeach",
)
