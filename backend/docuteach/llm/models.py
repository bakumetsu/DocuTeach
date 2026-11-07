from __future__ import annotations

import json
import re
import threading
from pathlib import Path
from typing import Any, Protocol, cast

from docuteach.config import Settings
from docuteach.errors import ApiError
from docuteach.llm.client import LlmClient
from docuteach.llm.overlay import Overlay
from docuteach.store.files import write_atomic


class _CancelAll(Protocol):
    async def cancel_all(self) -> None: ...


def effective_allowlist(settings: Settings, overlay: Overlay) -> set[str]:
    return set(settings.model_allowlist) | set(overlay.ids())


async def list_models(
    settings: Settings, client: LlmClient, *, overlay: Overlay | None = None
) -> list[dict[str, object]]:
    ids = await client.list_models()
    if not settings.allow_all_models:
        if overlay is not None:
            allowed = effective_allowlist(settings, overlay)
        else:
            allowed = set(settings.model_allowlist)
        ids = [i for i in ids if i in allowed]
    return [{"id": i, "label": i, "sizeGb": settings.model_sizes_gb.get(i, 0)} for i in ids]


async def current_model(
    settings: Settings, client: LlmClient, *, overlay: Overlay | None = None
) -> str | None:
    return await client.running()


async def select_model(
    settings: Settings, client: LlmClient, id: str, *, overlay: Overlay | None = None
) -> dict[str, object]:
    if not settings.allow_all_models:
        if overlay is not None:
            if id not in effective_allowlist(settings, overlay):
                raise ApiError("model_not_allowed", "Model not available", 400)
        elif id not in settings.model_allowlist:
            raise ApiError("model_not_allowed", "Model not available", 400)
    try:
        await client.load(id)
    except ApiError as e:
        if e.code in ("model_load_failed", "model_timeout"):
            return {"id": id, "status": "failed", "error": e.message}
        raise
    return {"id": id, "status": "ready"}


class ModelState:
    def __init__(self, settings: Settings, overlay: Overlay) -> None:
        self._settings = settings
        self._overlay = overlay
        self._lock = threading.Lock()
        self._overlay.set_target_dir(self.overlay_dir_path)

    @property
    def overlay(self) -> Overlay:
        return self._overlay

    def read(self) -> dict[str, str]:
        path = self._settings.models_json_path
        if not path.is_file():
            return {}
        try:
            data: object = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError, ValueError):
            return {}
        if not isinstance(data, dict):
            return {}
        raw = cast("dict[str, Any]", data)
        result: dict[str, str] = {}
        for key in ("default", "llama_server_path", "overlay_dir"):
            val = raw.get(key)
            if isinstance(val, str):
                result[key] = val
        return result

    def write(self, **changes: str | None) -> None:
        with self._lock:
            current = self.read()
            for key, val in changes.items():
                if val is None:
                    current.pop(key, None)
                else:
                    current[key] = val
            blob = json.dumps(current, indent=2, ensure_ascii=False).encode("utf-8")
            write_atomic(self._settings.models_json_path, blob)

    def llama_server(self) -> str:
        state = self.read()
        val = state.get("llama_server_path", "")
        if val:
            return val
        return self._settings.llama_server_path

    def managed_ids(self) -> list[str]:
        seen: set[str] = set()
        result: list[str] = []
        for mid in self._settings.model_allowlist:
            if mid not in seen:
                seen.add(mid)
                result.append(mid)
        for mid in self._overlay.ids():
            if mid not in seen:
                seen.add(mid)
                result.append(mid)
        return result

    def default_id(self) -> str | None:
        state = self.read()
        managed = self.managed_ids()
        default = state.get("default")
        if default is not None and default in managed:
            return default
        if managed:
            return managed[0]
        return None

    def overlay_dir(self) -> str:
        return self.read().get("overlay_dir", "")

    def overlay_dir_path(self) -> Path | None:
        val = self.overlay_dir()
        if val:
            return Path(val)
        return None

    def set_overlay_dir(self, path: str | None) -> None:
        if path is None or path == "":
            self.write(overlay_dir=None)
        else:
            self.write(overlay_dir=path)
            self._overlay.adopt_default_entries()


def _model_size_from_cmd(cmd: str) -> float:
    m = re.search(r'-m\s+("([^"]+)"|(\S+))', cmd)
    if not m:
        return 0.0
    model_path = m.group(2) or m.group(3)
    if not model_path:
        return 0.0
    p = Path(model_path)
    if not p.is_file():
        return 0.0
    try:
        size_bytes = p.stat().st_size
    except OSError:
        return 0.0
    return round(size_bytes / (1024**3), 1)


async def manage_list(
    settings: Settings, client: LlmClient, state: ModelState
) -> dict[str, object]:
    managed = state.managed_ids()
    default = state.default_id()
    overlay_ids = set(state.overlay.ids())
    allowlist = set(settings.model_allowlist)

    offline = False
    v1_ids: list[str] = []
    running: list[tuple[str, str]] = []

    try:
        v1_ids = await client.list_models()
    except ApiError as e:
        if e.code == "llm_offline":
            offline = True
        else:
            raise

    if not offline:
        running = await client.running_all()

    running_map: dict[str, str] = dict(running)
    overlay_error: str | None = None
    try:
        entries = state.overlay.read_entries()
    except ApiError as e:
        entries = {}
        overlay_error = e.message

    result: list[dict[str, object]] = []
    for mid in managed:
        size: float = settings.model_sizes_gb.get(mid, 0)
        if size == 0 and mid in overlay_ids and mid not in allowlist:
            entry = entries.get(mid, {})
            cmd = entry.get("cmd")
            if isinstance(cmd, str):
                size = _model_size_from_cmd(cmd)

        if offline:
            model_state = "unknown"
        elif running_map.get(mid) == "ready":
            model_state = "loaded"
        elif running_map.get(mid) in ("starting", "stopping"):
            model_state = "loading"
        elif mid in v1_ids:
            model_state = "unloaded"
        else:
            model_state = "missing"

        result.append(
            {
                "id": mid,
                "label": mid,
                "sizeGb": size,
                "state": model_state,
                "isDefault": mid == default,
                "source": "added" if mid in overlay_ids and mid not in allowlist else "default",
            }
        )
    return {"models": result, "overlayError": overlay_error, "overlayDir": state.overlay_dir()}


async def set_default(
    settings: Settings, state: ModelState, overlay: Overlay, id: str
) -> dict[str, object]:
    if id not in state.managed_ids():
        raise ApiError("model_not_allowed", "Model not available", 400)
    state.write(default=id)
    return {"default": id}


async def unload_model(
    settings: Settings,
    client: LlmClient,
    llm: _CancelAll,
    overlay: Overlay,
    id: str | None,
) -> dict[str, object]:
    state = ModelState(settings, overlay)
    if id is None:
        id = state.default_id()
        if id is None:
            return {"state": "unloaded"}
    if id not in state.managed_ids():
        raise ApiError("model_not_allowed", "Model not available", 400)

    running = await client.running_all()
    running_map: dict[str, str] = dict(running)
    if running_map.get(id) == "starting":
        raise ApiError("llm_busy", "AI is busy", 409)
    if id not in running_map:
        return {"state": "unloaded"}

    await llm.cancel_all()
    await client.unload(id)
    return {"state": "unloaded"}
