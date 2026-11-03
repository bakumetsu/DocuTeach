from __future__ import annotations

from docuteach.config import Settings
from docuteach.errors import ApiError
from docuteach.llm.client import LlmClient


async def list_models(settings: Settings, client: LlmClient) -> list[dict[str, object]]:
    ids = await client.list_models()
    if not settings.allow_all_models:
        ids = [i for i in ids if i in settings.model_allowlist]
    return [{"id": i, "label": i, "sizeGb": settings.model_sizes_gb.get(i, 0)} for i in ids]


async def current_model(settings: Settings, client: LlmClient) -> str | None:
    return await client.running()


async def select_model(settings: Settings, client: LlmClient, id: str) -> dict[str, object]:
    if not settings.allow_all_models and id not in settings.model_allowlist:
        raise ApiError("model_not_allowed", "Model not available", 400)
    try:
        await client.load(id)
    except ApiError as e:
        if e.code in ("model_load_failed", "model_timeout"):
            return {"id": id, "status": "failed", "error": e.message}
        raise
    return {"id": id, "status": "ready"}
