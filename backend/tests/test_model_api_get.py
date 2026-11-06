"""GET /models/custom/{id}: read the form back from the overlay entry."""

from __future__ import annotations

from typing import Any

import httpx
import pytest
import yaml

from docuteach.config import Settings
from tests.mock_llm import MockLlm
from tests.test_model_api import (  # pyright: ignore[reportUnusedImport]
    env,  # noqa: F401  # pyright: ignore[reportUnusedImport]
    make_gguf,
    make_server,
)

pytestmark = pytest.mark.anyio


async def test_get_custom_round_trip_and_unreadable(
    env: tuple[MockLlm, httpx.AsyncClient, Settings],  # noqa: F811
) -> None:
    _mock, client, s = env
    s.data_dir.mkdir(parents=True, exist_ok=True)
    await client.post("/api/models/server-path", json={"path": str(make_server(s.data_dir))})
    body: dict[str, Any] = {
        "id": "mycustom",
        "model_path": str(make_gguf(s.data_dir)),
        "parallel": 2,
        "ctx_per_chat": 4096,
        "reasoning": True,
        "temperature": 0.3,
        "top_p": 0.9,
        "top_k": 20,
        "min_p": 0.1,
        "ttl": 120,
    }
    assert (await client.post("/api/models/custom", json=body)).status_code == 200
    resp = await client.get("/api/models/custom/mycustom")
    assert resp.status_code == 200
    assert resp.json() == body

    assert (await client.get("/api/models/custom/nope")).status_code == 404

    data = yaml.safe_load(s.overlay_path.read_text(encoding="utf-8"))
    data["models"]["mycustom"]["cmd"] = "something --else"
    s.overlay_path.write_text(yaml.safe_dump(data), encoding="utf-8")
    resp = await client.get("/api/models/custom/mycustom")
    assert resp.status_code == 409
