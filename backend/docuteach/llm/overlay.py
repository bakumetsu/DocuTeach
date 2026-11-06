"""Llama-swap overlay management for DocuTeach teaching models."""

from __future__ import annotations

import re
import shutil
import subprocess
import threading
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, cast

import yaml

from docuteach.errors import ApiError
from docuteach.store.files import write_atomic

MODEL_CMD_TEMPLATE: tuple[str, ...] = (
    "--jinja",
    "--flash-attn",
    "on",
    "--host",
    "127.0.0.1",
    "--port",
    "${PORT}",
)

_ID_RE = re.compile(r"^[a-z][a-z0-9-]{1,31}$")

_INVALID_MSG = "The models file is not valid; restore it from history first"


@dataclass(frozen=True)
class ModelForm:
    id: str
    model_path: str
    parallel: int = 4
    ctx_per_chat: int = 8192
    reasoning: bool = False
    temperature: float = 0.7
    top_p: float = 0.95
    top_k: int = 40
    min_p: float = 0.05
    ttl: int = 600


def validate_form(form: ModelForm, *, taken_ids: set[str]) -> ModelForm:
    if not _ID_RE.match(form.id):
        raise ApiError("bad_model_form", "id must match ^[a-z][a-z0-9-]{1,31}$", 400)
    if form.id in taken_ids:
        raise ApiError("bad_model_form", "id already exists", 400)
    if '"' in form.model_path:
        raise ApiError("bad_model_form", "model_path must not contain a double-quote", 400)
    if "\n" in form.model_path or "\r" in form.model_path:
        raise ApiError("bad_model_form", "model_path must not contain a newline", 400)
    if not form.model_path.lower().endswith(".gguf"):
        raise ApiError("bad_model_form", "model_path must end with .gguf", 400)
    if not Path(form.model_path).is_file():
        raise ApiError("bad_model_form", "model_path is not an existing file", 400)
    if not 1 <= form.parallel <= 8:
        raise ApiError("bad_model_form", "parallel must be between 1 and 8", 400)
    if not 2048 <= form.ctx_per_chat <= 32768:
        raise ApiError("bad_model_form", "ctx_per_chat must be between 2048 and 32768", 400)
    if form.parallel * form.ctx_per_chat > 131072:
        raise ApiError("bad_model_form", "parallel * ctx_per_chat exceeds 131072", 400)
    if not 0 <= form.temperature <= 2:
        raise ApiError("bad_model_form", "temperature must be between 0 and 2", 400)
    if not 0 <= form.top_p <= 1:
        raise ApiError("bad_model_form", "top_p must be between 0 and 1", 400)
    if not 0 <= form.top_k <= 200:
        raise ApiError("bad_model_form", "top_k must be between 0 and 200", 400)
    if not 0 <= form.min_p <= 1:
        raise ApiError("bad_model_form", "min_p must be between 0 and 1", 400)
    if not 0 <= form.ttl <= 3600:
        raise ApiError("bad_model_form", "ttl must be between 0 and 3600", 400)
    return form


def build_cmd(llama_server: str, form: ModelForm) -> str:
    if '"' in llama_server or "\n" in llama_server or "\r" in llama_server:
        raise ApiError("bad_model_form", "llama_server must not contain quotes or newlines", 400)
    if not llama_server.lower().endswith("llama-server.exe"):
        raise ApiError("bad_model_form", "llama_server must end with llama-server.exe", 400)
    args: list[str] = [
        llama_server,
        "-m",
        form.model_path,
        "-np",
        str(form.parallel),
        "-c",
        str(form.parallel * form.ctx_per_chat),
        "--temp",
        str(form.temperature),
        "--top-p",
        str(form.top_p),
        "--top-k",
        str(form.top_k),
        "--min-p",
        str(form.min_p),
        "--reasoning",
        "on" if form.reasoning else "off",
        *MODEL_CMD_TEMPLATE,
    ]
    return subprocess.list2cmdline(args)


def _split_cmd(cmd: str) -> list[str]:
    """Split a command built by build_cmd (quotes only wrap whitespace-bearing args)."""
    args: list[str] = []
    cur: list[str] = []
    in_q = False
    has = False
    for ch in cmd:
        if ch == '"':
            in_q = not in_q
            has = True
        elif ch.isspace() and not in_q:
            if has:
                args.append("".join(cur))
                cur, has = [], False
        else:
            cur.append(ch)
            has = True
    if in_q:
        raise ValueError("unbalanced quote")
    if has:
        args.append("".join(cur))
    return args


def parse_entry(model_id: str, entry: dict[str, object]) -> ModelForm:
    """Read a ModelForm back from an overlay entry; ValueError if build_cmd did not write it."""
    try:
        cmd = entry["cmd"]
        ttl = entry["ttl"]
        if not isinstance(cmd, str) or not isinstance(ttl, int) or isinstance(ttl, bool):
            raise ValueError("entry has no cmd or ttl")
        args = _split_cmd(cmd)
        opts = {args[i]: args[i + 1] for i in range(1, 17, 2)}
        form = ModelForm(
            id=model_id,
            model_path=opts["-m"],
            parallel=int(opts["-np"]),
            ctx_per_chat=int(opts["-c"]) // int(opts["-np"]),
            reasoning=opts["--reasoning"] == "on",
            temperature=float(opts["--temp"]),
            top_p=float(opts["--top-p"]),
            top_k=int(opts["--top-k"]),
            min_p=float(opts["--min-p"]),
            ttl=ttl,
        )
        if build_cmd(args[0], form) != cmd:
            raise ValueError("cmd does not match the template")
    except (KeyError, IndexError, ZeroDivisionError, ApiError) as exc:
        raise ValueError("entry cannot be read back into the form") from exc
    return form


def entry_yaml(llama_server: str, form: ModelForm) -> str:
    cmd = build_cmd(llama_server, form)
    data: dict[str, Any] = {"models": {form.id: {"cmd": cmd, "ttl": form.ttl}}}
    text = yaml.safe_dump(data, sort_keys=False)
    re_parsed = yaml.safe_load(text)
    if re_parsed != data:
        raise ApiError("overlay_roundtrip", "Entry does not round-trip", 500)
    return text


class Overlay:
    def __init__(
        self,
        path: Path,
        history_keep: int = 20,
        *,
        target_dir: Callable[[], Path | None] | None = None,
    ) -> None:
        self._path = path
        self._history_keep = history_keep
        self._history_dir = path.with_name(path.name + ".history")
        self._lock = threading.Lock()
        self._last_stamp: datetime | None = None
        self._target_dir = target_dir

    def active_path(self) -> Path:
        if self._target_dir is not None:
            td = self._target_dir()
            if td is not None:
                return td / self._path.name
        return self._path

    def set_target_dir(self, fn: Callable[[], Path | None] | None) -> None:
        self._target_dir = fn

    # -- internal helpers (caller must hold self._lock for write paths) --

    def _stamp(self) -> str:
        now = datetime.now(UTC)
        if self._last_stamp is not None and now <= self._last_stamp:
            now = self._last_stamp + timedelta(microseconds=1)
        self._last_stamp = now
        return now.strftime("%Y%m%dT%H%M%S%fZ")

    def _snapshot(self, stamp: str) -> None:
        self._history_dir.mkdir(parents=True, exist_ok=True)
        hist_file = self._history_dir / f"{stamp}.yaml"
        src = self.active_path()
        if src.exists():
            shutil.copyfile(src, hist_file)
        else:
            hist_file.write_bytes(b"models: {}\n")

    def _prune_history(self) -> None:
        if not self._history_dir.is_dir():
            return
        files = sorted(
            (f for f in self._history_dir.iterdir() if f.suffix == ".yaml"),
            key=lambda f: f.name,
        )
        excess = max(0, len(files) - self._history_keep)
        for f in files[:excess]:
            f.unlink(missing_ok=True)

    def _do_write(self, text: str) -> str:
        """Snapshot + atomic write + prune.  Caller must hold the lock."""
        stamp = self._stamp()
        self._snapshot(stamp)
        write_atomic(self.active_path(), text.encode("utf-8"))
        self._prune_history()
        return stamp

    # -- public API --

    def read_entries(self) -> dict[str, dict[str, object]]:
        p = self.active_path()
        if not p.exists():
            return {}
        try:
            text = p.read_text(encoding="utf-8")
        except OSError:
            raise ApiError("overlay_invalid", _INVALID_MSG, 409) from None
        return self.parse_entries(text)

    @staticmethod
    def parse_entries(text: str) -> dict[str, dict[str, object]]:
        try:
            data: Any = yaml.safe_load(text)
        except yaml.YAMLError:
            raise ApiError("overlay_invalid", _INVALID_MSG, 409) from None
        if not isinstance(data, dict):
            raise ApiError("overlay_invalid", _INVALID_MSG, 409)
        raw_models: Any = cast("dict[Any, Any]", data).get("models")
        if not isinstance(raw_models, dict):
            raise ApiError("overlay_invalid", _INVALID_MSG, 409)
        models = cast("dict[str, Any]", raw_models)
        for val in models.values():
            if not isinstance(val, dict):
                raise ApiError("overlay_invalid", _INVALID_MSG, 409)
        return cast("dict[str, dict[str, object]]", models)

    def ids(self) -> list[str]:
        try:
            return list(self.read_entries().keys())
        except ApiError:
            return []

    def is_invalid(self) -> bool:
        if not self.active_path().exists():
            return False
        try:
            self.read_entries()
            return False
        except ApiError:
            return True

    def put(self, model_id: str, entry: dict[str, object], *, replace: bool = False) -> str:
        """Add an entry; with replace=True edit an existing one. One history entry either way."""
        with self._lock:
            entries = self.read_entries()
            if replace:
                if model_id not in entries:
                    raise ApiError("not_found", "Model not found", 404)
            elif model_id in entries:
                raise ApiError("model_exists", "A model with this id already exists", 409)
            entries[model_id] = entry
            data: dict[str, Any] = {"models": entries}
            text = yaml.safe_dump(data, sort_keys=False)
            return self._do_write(text)

    def remove(self, model_id: str) -> str:
        with self._lock:
            entries = self.read_entries()
            if model_id not in entries:
                raise ApiError("not_found", "Model not found", 404)
            del entries[model_id]
            data: dict[str, Any] = {"models": entries}
            text = yaml.safe_dump(data, sort_keys=False)
            return self._do_write(text)

    def undo(self) -> None:
        with self._lock:
            if not self._history_dir.is_dir():
                raise ApiError("nothing_to_undo", "Nothing to undo", 409)
            files = sorted(
                (f for f in self._history_dir.iterdir() if f.suffix == ".yaml"),
                key=lambda f: f.name,
                reverse=True,
            )
            if not files:
                raise ApiError("nothing_to_undo", "Nothing to undo", 409)
            newest = files[0]
            content = newest.read_bytes()
            try:
                self.parse_entries(content.decode("utf-8"))
            except (ApiError, UnicodeDecodeError):
                raise ApiError(
                    "undo_invalid",
                    "The saved earlier version is damaged; nothing was changed",
                    409,
                ) from None
            write_atomic(self.active_path(), content)
            newest.unlink(missing_ok=True)

    def adopt_default_entries(self) -> None:
        """Copy the default overlay file into the active path if the active file is absent."""
        with self._lock:
            if self._target_dir is None:
                return
            td = self._target_dir()
            if td is None:
                return
            default_file = self._path
            active = self.active_path()
            if default_file.exists() and not active.exists():
                active.parent.mkdir(parents=True, exist_ok=True)
                write_atomic(active, default_file.read_bytes())
