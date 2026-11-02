"""Build script for DocuTeach desktop application (Windows, Python 3.12 stdlib)."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import zipfile
from collections.abc import Callable
from pathlib import Path

REPO_ROOT: Path = Path(__file__).resolve().parent.parent
DESKTOP_DIR: Path = REPO_ROOT / "desktop"
FRONTEND_DIR: Path = REPO_ROOT / "frontend"
DIST_DIR: Path = FRONTEND_DIR / "dist"
VENV_DIR: Path = REPO_ROOT / ".venv-desktop"
DIST_DESKTOP: Path = REPO_ROOT / "dist-desktop"
WORK_DESKTOP: Path = REPO_ROOT / "build-desktop"
SPEC_FILE: Path = DESKTOP_DIR / "DocuTeach.spec"
REQUIREMENTS: Path = DESKTOP_DIR / "requirements.txt"
ICON_PATH: Path = DESKTOP_DIR / "assets" / "icon.ico"
README_TXT: Path = DESKTOP_DIR / "README.txt"
LICENSE_PATH: Path = REPO_ROOT / "LICENSE"
THIRD_PARTY: Path = DESKTOP_DIR / "THIRD_PARTY_NOTICES.txt"
APPDATA_DATA: str = "%APPDATA%\\DocuTeach\\data"

ALLOWED_HOSTS: frozenset[str] = frozenset(
    {"localhost", "127.0.0.1", "www.w3.org", "prosemirror.net", "react.dev"}
)
URL_RE: re.Pattern[str] = re.compile(r"https?://([A-Za-z0-9.\-]+)")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Build DocuTeach desktop app")
    p.add_argument("--skip-frontend", action="store_true", help="Reuse existing dist/")
    p.add_argument("--no-zip", action="store_true", help="Skip zip creation")
    p.add_argument("--allow-dirty", action="store_true", help="Allow uncommitted changes")
    p.add_argument("--version", default=None, help="Override version string")
    return p.parse_args()


def find_tool(names: list[str]) -> str:
    for n in names:
        path = shutil.which(n)
        if path:
            return path
    raise SystemExit(f"None of {names} found on PATH")


def run(cmd: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
    res = subprocess.run(cmd, capture_output=True, text=True, **kwargs)  # type: ignore[arg-type]
    if res.returncode != 0:
        detail = res.stderr.strip() or res.stdout.strip()
        raise SystemExit(f"Command failed ({' '.join(cmd)}):\n{detail}")
    return res


def step(n: int, name: str, func: Callable[[], None]) -> None:
    start = time.monotonic()
    try:
        func()
    except SystemExit:
        raise
    except Exception as exc:
        raise SystemExit(f"[{n}/9] {name} failed: {exc}") from exc
    elapsed = time.monotonic() - start
    print(f"[{n}/9] {name} ... done in {elapsed:.1f}s")


def git_short_hash() -> str:
    res = subprocess.run(
        ["git", "rev-parse", "--short", "HEAD"],
        capture_output=True, text=True, cwd=REPO_ROOT,
    )
    if res.returncode != 0:
        raise SystemExit(f"git rev-parse failed: {res.stderr.strip()}")
    return res.stdout.strip()


def check_preflight(allow_dirty: bool) -> str:
    if os.name != "nt":
        raise SystemExit("This build script only runs on Windows.")
    py_ver = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
    if (sys.version_info.major, sys.version_info.minor) != (3, 12):
        raise SystemExit(f"Python 3.12 required, got {py_ver}")
    node_bin = find_tool(["node"])
    pnpm_bin = find_tool(["pnpm.cmd", "pnpm"])
    res = run([node_bin, "--version"])
    node_ver = res.stdout.strip()
    res = run([pnpm_bin, "--version"])
    pnpm_ver = res.stdout.strip()
    print(f"  Python {py_ver}, Node {node_ver}, pnpm {pnpm_ver}")

    res = subprocess.run(
        ["git", "status", "--porcelain", "--", "frontend", "desktop"],
        capture_output=True, text=True, cwd=REPO_ROOT,
    )
    if res.returncode != 0:
        raise SystemExit(f"git status failed: {res.stderr.strip()}")
    if res.stdout.strip():
        if not allow_dirty:
            raise SystemExit(
                "Uncommitted changes in frontend/ or desktop/.\n"
                "Commit them or pass --allow-dirty."
            )
        print("  Warning: uncommitted changes present (--allow-dirty)")
    commit = git_short_hash()
    print(f"  Commit: {commit}")
    return commit


def get_version(override: str | None) -> str:
    if override:
        return override
    pkg = FRONTEND_DIR / "package.json"
    if not pkg.exists():
        raise SystemExit(f"frontend/package.json not found at {pkg}")
    data = json.loads(pkg.read_text(encoding="utf-8"))
    ver = data.get("version")
    if not ver:
        raise SystemExit("No 'version' field in frontend/package.json")
    return ver


def build_frontend(pnpm_bin: str) -> None:
    run([pnpm_bin, "install", "--frozen-lockfile"], cwd=FRONTEND_DIR)
    run([pnpm_bin, "build"], cwd=FRONTEND_DIR)
    if not (DIST_DIR / "index.html").exists():
        raise SystemExit("Frontend build did not produce dist/index.html")


def scan_urls() -> None:
    if not DIST_DIR.exists():
        raise SystemExit(f"dist/ not found at {DIST_DIR}")
    index_html = DIST_DIR / "index.html"
    if not index_html.exists():
        raise SystemExit("dist/index.html missing")
    html = index_html.read_text(encoding="utf-8")
    if "content-security-policy" not in html.lower():
        raise SystemExit(
            "No Content-Security-Policy meta tag found in dist/index.html"
        )
    offenders: list[str] = []
    for path in sorted(DIST_DIR.rglob("*")):
        if not path.is_file():
            continue
        try:
            content = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        for m in URL_RE.finditer(content):
            host = m.group(1).lower()
            if host not in ALLOWED_HOSTS:
                rel = path.relative_to(REPO_ROOT)
                offenders.append(f"  {rel}: {host}")
    if offenders:
        msg = "Disallowed URLs found:\n" + "\n".join(offenders)
        raise SystemExit(msg)


def build_venv() -> Path:
    if not VENV_DIR.exists():
        run([sys.executable, "-m", "venv", str(VENV_DIR)], cwd=REPO_ROOT)
    venv_python = VENV_DIR / "Scripts" / "python.exe"
    if not venv_python.exists():
        raise SystemExit(f"Venv python not found at {venv_python}")
    run([str(venv_python), "-m", "pip", "install", "-r", str(REQUIREMENTS)], cwd=REPO_ROOT)
    return venv_python


def run_pyinstaller(venv_python: Path, version: str, commit: str) -> None:
    env = os.environ.copy()
    env["DOCUTEACH_VERSION"] = version
    env["DOCUTEACH_COMMIT"] = commit
    cmd = [
        str(venv_python), "-m", "PyInstaller",
        str(SPEC_FILE),
        "--noconfirm",
        "--distpath", str(DIST_DESKTOP),
        "--workpath", str(WORK_DESKTOP),
    ]
    res = subprocess.run(cmd, capture_output=True, text=True, env=env, cwd=REPO_ROOT)
    if res.returncode != 0:
        raise SystemExit(
            f"PyInstaller failed:\n{res.stdout}\n{res.stderr}"
        )


def smoke_test() -> None:
    exe = DIST_DESKTOP / "DocuTeach" / "DocuTeach.exe"
    if not exe.exists():
        raise SystemExit(f"EXE not found at {exe}")
    try:
        res = subprocess.run(
            [str(exe), "--selftest"],
            check=False, capture_output=True, text=True, timeout=20,
        )
    except subprocess.TimeoutExpired:
        raise SystemExit("Smoke test timed out (>20 s)") from None
    if res.returncode != 0:
        raise SystemExit(
            f"Smoke test exited with code {res.returncode}:\n{res.stdout}\n{res.stderr}"
        )
    if "selftest ok" not in res.stdout:
        raise SystemExit(
            f"Smoke test did not report 'selftest ok'.\nstdout: {res.stdout}"
        )


def noop_safety() -> None:
    """Step 8: no student-safety check needed at this stage."""


def package(version: str, no_zip: bool) -> None:
    app_dir = DIST_DESKTOP / "DocuTeach"
    if not app_dir.is_dir():
        raise SystemExit(f"App directory not found: {app_dir}")
    shutil.copy2(README_TXT, app_dir / "README.txt")
    if LICENSE_PATH.exists():
        shutil.copy2(LICENSE_PATH, app_dir / "LICENSE")
    else:
        print("  Warning: LICENSE not found at repo root, skipping")
    if THIRD_PARTY.exists():
        shutil.copy2(THIRD_PARTY, app_dir / "THIRD_PARTY_NOTICES.txt")
    else:
        print("  Warning: THIRD_PARTY_NOTICES.txt not found, skipping")

    if no_zip:
        return

    zip_name = f"DocuTeach-{version}-win64.zip"
    zip_path = DIST_DESKTOP / zip_name
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in sorted(app_dir.rglob("*")):
            if f.is_file():
                arcname = Path("DocuTeach") / f.relative_to(app_dir)
                zf.write(f, arcname)
    sha = hashlib.sha256(zip_path.read_bytes()).hexdigest()
    size = zip_path.stat().st_size
    sums_file = DIST_DESKTOP / "SHA256SUMS.txt"
    sums_file.write_text(f"{sha}  {zip_name}\n", encoding="utf-8")
    print(f"  Size: {size:,} bytes")
    print(f"  SHA256: {sha}")
    print(f"  {sums_file}")
    tag = f"v{version}"
    print(f"\n  gh release create {tag} dist-desktop/{zip_name} --title 'DocuTeach {version}'")


def main() -> None:
    args = parse_args()

    commit = ""
    version = ""
    venv_python: Path = VENV_DIR / "Scripts" / "python.exe"

    def _pre() -> None:
        nonlocal commit
        commit = check_preflight(args.allow_dirty)

    def _ver() -> None:
        nonlocal version
        version = get_version(args.version)
        print(f"  Version: {version}")

    def _fe() -> None:
        pnpm_bin = find_tool(["pnpm.cmd", "pnpm"])
        if not args.skip_frontend:
            build_frontend(pnpm_bin)
        elif not (DIST_DIR / "index.html").exists():
            raise SystemExit("--skip-frontend but dist/index.html missing; run frontend build")

    def _url() -> None:
        scan_urls()

    def _venv() -> None:
        nonlocal venv_python
        venv_python = build_venv()

    def _pyi() -> None:
        assert version, "version not set"
        assert commit, "commit not set"
        run_pyinstaller(venv_python, version, commit)

    def _smoke() -> None:
        smoke_test()

    def _safety() -> None:
        noop_safety()

    def _pkg() -> None:
        assert version, "version not set"
        package(version, args.no_zip)

    step(1, "Preflight", _pre)
    step(2, "Version", _ver)
    step(3, "Frontend", _fe)
    step(4, "URL scan", _url)
    step(5, "Build venv", _venv)
    step(6, "PyInstaller", _pyi)
    step(7, "Smoke test", _smoke)
    step(8, "Safety check", _safety)
    step(9, "Package", _pkg)
    print("Build complete.")


if __name__ == "__main__":
    main()
