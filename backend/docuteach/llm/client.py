from __future__ import annotations

from contextlib import AbstractAsyncContextManager
from typing import Any, cast

import httpx

from docuteach.config import Settings
from docuteach.errors import ApiError


class LlmClient:
    def __init__(self, settings: Settings, http: httpx.AsyncClient | None = None) -> None:
        self._settings: Settings = settings
        if http is None:
            http = httpx.AsyncClient(
                base_url=settings.llm_base_url,
                timeout=httpx.Timeout(10.0, read=None),
            )
        self.http: httpx.AsyncClient = http

    async def aclose(self) -> None:
        await self.http.aclose()

    def _offline(self, exc: Exception) -> ApiError:
        if isinstance(
            exc,
            (
                httpx.ConnectError,
                httpx.ConnectTimeout,
                httpx.ReadError,
                httpx.RemoteProtocolError,
                httpx.PoolTimeout,
            ),
        ):
            return ApiError("llm_offline", "AI is offline", 503)
        return ApiError("llm_error", str(exc), 502)

    async def list_models(self) -> list[str]:
        try:
            resp = await self.http.get("/v1/models")
        except Exception as exc:
            raise self._offline(exc) from exc
        if resp.status_code == 503:
            raise ApiError("llm_busy", "AI is busy", 429)
        if resp.status_code >= 400:
            raise ApiError("llm_bad_response", "The AI server sent an unexpected reply", 502)
        try:
            data: list[dict[str, str]] = cast("list[dict[str, str]]", resp.json()["data"])
            return [m["id"] for m in data]
        except (ValueError, KeyError, TypeError):
            raise ApiError(
                "llm_bad_response", "The AI server sent an unexpected reply", 502
            ) from None

    async def running(self) -> str | None:
        try:
            resp = await self.http.get("/running")
            data: dict[str, object] = resp.json()
        except Exception:
            return None
        raw = data.get("running")
        items = cast("list[dict[str, str]]", raw) if isinstance(raw, list) else []
        for item in items:
            if item.get("state") == "ready":
                return item["model"]
        return None

    async def load(self, model: str) -> None:
        try:
            resp = await self.http.post(
                "/v1/chat/completions",
                json={
                    "model": model,
                    "max_tokens": 1,
                    "messages": [{"role": "user", "content": "hi"}],
                    "stream": False,
                },
                timeout=httpx.Timeout(self._settings.swap_timeout_s),
            )
        except httpx.ReadTimeout:
            raise ApiError("model_timeout", "Timed out", 504) from None
        except Exception as exc:
            raise self._offline(exc) from exc
        if resp.status_code == 503:
            raise ApiError("llm_busy", "AI is busy", 429)
        if resp.status_code >= 400:
            raise ApiError("model_load_failed", resp.text[:200], 502)

    async def props(self, model: str) -> tuple[int, int] | None:
        try:
            resp = await self.http.get(f"/upstream/{model}/props")
            data: dict[str, Any] = resp.json()
            total_slots: int = data["total_slots"]
            n_ctx: int = data["default_generation_settings"]["n_ctx"]
            return (total_slots, n_ctx)
        except Exception:
            return None

    async def erase_slot(self, model: str, slot: int) -> None:
        try:
            await self.http.post(f"/upstream/{model}/slots/{slot}", params={"action": "erase"})
        except Exception:
            pass

    def stream_chat(
        self,
        model: str,
        messages: list[dict[str, str]],
        id_slot: int | None,
        temperature: float | None = None,
    ) -> AbstractAsyncContextManager[httpx.Response]:
        payload: dict[str, object] = {
            "model": model,
            "messages": messages,
            "stream": True,
            "max_tokens": self._settings.max_answer_tokens,
            "cache_prompt": True,
        }
        if id_slot is not None:
            payload["id_slot"] = id_slot
        if temperature is not None:
            payload["temperature"] = temperature
        return self.http.stream(
            "POST",
            "/v1/chat/completions",
            json=payload,
            timeout=httpx.Timeout(10.0, read=None),
        )

    async def ping(self) -> bool:
        try:
            await self.list_models()
            return True
        except ApiError:
            return False
