from __future__ import annotations

import json
import os
from collections.abc import Mapping
from pathlib import Path
from urllib.parse import urlparse

from pydantic import BaseModel


def _default_data_dir() -> Path:
    appdata = os.environ.get("APPDATA")
    if appdata:
        return Path(appdata) / "DocuTeach"
    return Path.home() / "DocuTeach"


def _default_log_dir() -> Path:
    local = os.environ.get("LOCALAPPDATA")
    if local:
        return Path(local) / "DocuTeach" / "logs"
    return Path.home() / ".docuteach" / "logs"


class Settings(BaseModel):
    data_dir: Path
    log_dir: Path
    llm_base_url: str = "http://127.0.0.1:8080"
    slots: int = 4
    swap_timeout_s: int = 300
    idle_token_timeout_s: int = 120
    max_markdown_bytes: int = 5_000_000
    max_chats_bytes: int = 5_000_000
    checkpoint_cap: int = 50
    auto_checkpoint_cap: int = 50
    trash_days: int = 30
    max_prompt_chars: int = 24_000
    max_answer_tokens: int = 2048
    export_timeout_s: int = 120
    token: str = ""
    port: int = 0
    version: str = "0.1.0"
    model_allowlist: list[str] = ["byteshape"]
    model_sizes_gb: dict[str, float] = {}
    allow_all_models: bool = False
    llama_server_path: str = ""

    @property
    def models_json_path(self) -> Path:
        return self.data_dir / "models.json"

    @property
    def overlay_path(self) -> Path:
        return self.data_dir / "llama-swap-docuteach.yaml"

    @property
    def lessons_dir(self) -> Path:
        return self.data_dir / "lessons"

    @property
    def d07_data_dir(self) -> Path:
        return self.data_dir / "data"


class _SettingsOverride(BaseModel):
    data_dir: Path | None = None
    log_dir: Path | None = None
    llm_base_url: str | None = None
    slots: int | None = None
    swap_timeout_s: int | None = None
    idle_token_timeout_s: int | None = None
    max_markdown_bytes: int | None = None
    max_chats_bytes: int | None = None
    checkpoint_cap: int | None = None
    auto_checkpoint_cap: int | None = None
    trash_days: int | None = None
    max_prompt_chars: int | None = None
    max_answer_tokens: int | None = None
    export_timeout_s: int | None = None
    model_allowlist: list[str] | None = None
    model_sizes_gb: dict[str, float] | None = None
    llama_server_path: str | None = None


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    if env is None:
        env = os.environ

    data_dir = (
        Path(env["DOCUTEACH_DATA_DIR"]) if "DOCUTEACH_DATA_DIR" in env else _default_data_dir()
    )
    log_dir = Path(env["DOCUTEACH_LOG_DIR"]) if "DOCUTEACH_LOG_DIR" in env else _default_log_dir()
    llm_base_url: str = env.get("DOCUTEACH_LLM_BASE_URL", "http://127.0.0.1:8080")
    slots: int = int(env.get("DOCUTEACH_SLOTS", "4"))
    swap_timeout_s: int = int(env.get("DOCUTEACH_SWAP_TIMEOUT_S", "300"))
    idle_token_timeout_s: int = int(env.get("DOCUTEACH_IDLE_TOKEN_TIMEOUT_S", "120"))
    max_markdown_bytes: int = int(env.get("DOCUTEACH_MAX_MARKDOWN_BYTES", "5000000"))
    max_chats_bytes: int = int(env.get("DOCUTEACH_MAX_CHATS_BYTES", "5000000"))
    checkpoint_cap: int = int(env.get("DOCUTEACH_CHECKPOINT_CAP", "50"))
    auto_checkpoint_cap: int = int(env.get("DOCUTEACH_AUTO_CHECKPOINT_CAP", "50"))
    trash_days: int = int(env.get("DOCUTEACH_TRASH_DAYS", "30"))
    max_prompt_chars: int = int(env.get("DOCUTEACH_MAX_PROMPT_CHARS", "24000"))
    max_answer_tokens: int = int(env.get("DOCUTEACH_MAX_ANSWER_TOKENS", "2048"))
    export_timeout_s: int = int(env.get("DOCUTEACH_EXPORT_TIMEOUT_S", "120"))
    token: str = env.get("DOCUTEACH_TOKEN", "")
    port: int = int(env.get("DOCUTEACH_PORT", "0"))
    model_allowlist: list[str] = (
        [s.strip() for s in env["DOCUTEACH_MODEL_ALLOWLIST"].split(",") if s.strip()]
        if "DOCUTEACH_MODEL_ALLOWLIST" in env
        else ["byteshape"]
    )
    model_sizes_gb: dict[str, float] = {}
    allow_all_models: bool = env.get("DOCUTEACH_ALLOW_ALL_MODELS", "") == "1"
    llama_server_path: str = env.get("DOCUTEACH_LLAMA_SERVER_PATH", "")

    settings_file = data_dir / "settings.json"
    if settings_file.is_file():
        try:
            raw = settings_file.read_text(encoding="utf-8")
            o: _SettingsOverride = _SettingsOverride.model_validate_json(raw)
            if o.data_dir is not None:
                data_dir = o.data_dir
            if o.log_dir is not None:
                log_dir = o.log_dir
            if o.llm_base_url is not None:
                llm_base_url = o.llm_base_url
            if o.slots is not None:
                slots = o.slots
            if o.swap_timeout_s is not None:
                swap_timeout_s = o.swap_timeout_s
            if o.idle_token_timeout_s is not None:
                idle_token_timeout_s = o.idle_token_timeout_s
            if o.max_markdown_bytes is not None:
                max_markdown_bytes = o.max_markdown_bytes
            if o.max_chats_bytes is not None:
                max_chats_bytes = o.max_chats_bytes
            if o.checkpoint_cap is not None:
                checkpoint_cap = o.checkpoint_cap
            if o.auto_checkpoint_cap is not None:
                auto_checkpoint_cap = o.auto_checkpoint_cap
            if o.trash_days is not None:
                trash_days = o.trash_days
            if o.max_prompt_chars is not None:
                max_prompt_chars = o.max_prompt_chars
            if o.max_answer_tokens is not None:
                max_answer_tokens = o.max_answer_tokens
            if o.export_timeout_s is not None:
                export_timeout_s = o.export_timeout_s
            if o.model_allowlist is not None:
                model_allowlist = o.model_allowlist
            if o.model_sizes_gb is not None:
                model_sizes_gb = o.model_sizes_gb
            if o.llama_server_path is not None:
                llama_server_path = o.llama_server_path
        except (json.JSONDecodeError, OSError, ValueError):
            pass

    return Settings(
        data_dir=data_dir,
        log_dir=log_dir,
        llm_base_url=llm_base_url,
        slots=slots,
        swap_timeout_s=swap_timeout_s,
        idle_token_timeout_s=idle_token_timeout_s,
        max_markdown_bytes=max_markdown_bytes,
        max_chats_bytes=max_chats_bytes,
        checkpoint_cap=checkpoint_cap,
        auto_checkpoint_cap=auto_checkpoint_cap,
        trash_days=trash_days,
        max_prompt_chars=max_prompt_chars,
        max_answer_tokens=max_answer_tokens,
        export_timeout_s=export_timeout_s,
        token=token,
        port=port,
        model_allowlist=model_allowlist,
        model_sizes_gb=model_sizes_gb,
        allow_all_models=allow_all_models,
        llama_server_path=llama_server_path,
    )


def check_local_llm(settings: Settings) -> None:
    parsed = urlparse(settings.llm_base_url)
    host = parsed.hostname or ""
    if host not in ("127.0.0.1", "localhost", "::1"):
        raise ValueError(
            f"llm_base_url host must be loopback (127.0.0.1, localhost, ::1), got: {host!r}"
        )
