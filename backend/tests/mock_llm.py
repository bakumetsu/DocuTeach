"""Mock llama-swap server for tests."""

from __future__ import annotations

import asyncio
import json
import socket
import time
from collections.abc import AsyncGenerator, AsyncIterator
from contextlib import asynccontextmanager
from typing import Any, cast

import uvicorn
from fastapi import FastAPI, Query, Request
from fastapi.responses import PlainTextResponse, StreamingResponse


class MockLlm:
    """A mock llama-swap server usable in tests."""

    def __init__(self) -> None:
        self.models: list[str] = ["byteshape", "other"]
        self.running_model: str | None = None
        self.total_slots: int = 2
        self.n_ctx: int = 16384
        self.tokens: list[str] = ["Hel", "lo", " wor", "ld"]
        self.delay: float = 0.0
        self.reasoning_tokens: list[str] = []
        self.fail_on: str = "[fail]"
        self.load_delay: float = 0.0
        self.load_status: int = 200
        self.chat_status: int = 200
        self.first_byte_delay: float = 0.0

        self.slots_seen: list[int | None] = []
        self.erased: list[int] = []
        self.emitted: int = 0
        self.closed_at: float | None = None
        self.last_request: dict[str, Any] | None = None
        self.requests: list[dict[str, Any]] = []
        self.props_calls: int = 0

        self.app: FastAPI = FastAPI()
        self._register_routes()

    def _register_routes(self) -> None:
        @self.app.get("/v1/models")
        async def get_models() -> dict[str, Any]:
            return {"data": [{"id": m} for m in self.models]}

        @self.app.get("/running")
        async def get_running() -> dict[str, Any]:
            if self.running_model is not None:
                return {"running": [{"model": self.running_model, "state": "ready"}]}
            return {"running": []}

        @self.app.get("/upstream/{model}/props")
        async def get_props(model: str) -> dict[str, Any]:
            self.props_calls += 1
            return {
                "total_slots": self.total_slots,
                "default_generation_settings": {"n_ctx": self.n_ctx},
            }

        @self.app.post("/upstream/{model}/slots/{n}")
        async def erase_slot(model: str, n: int, action: str = Query("erase")) -> dict[str, Any]:
            if action == "erase":
                self.erased.append(n)
            return {"ok": True}

        @self.app.post("/v1/chat/completions")
        async def chat_completions(request: Request) -> Any:
            body: dict[str, Any] = await request.json()
            self.requests.append(body)
            self.last_request = body

            if not body.get("stream"):
                await asyncio.sleep(self.load_delay)
                if self.load_status >= 400:
                    return PlainTextResponse("load error", status_code=self.load_status)
                self.running_model = body["model"]
                return {"choices": [{"message": {"content": ""}}], "model": body["model"]}

            self.slots_seen.append(body.get("id_slot"))

            if self.chat_status != 200:
                return PlainTextResponse("busy", status_code=self.chat_status)

            self.running_model = body["model"]
            self.emitted = 0
            self.closed_at = None

            should_fail = False
            messages: list[Any] = body.get("messages", [])
            for msg in messages:
                if isinstance(msg, dict):
                    content: str = str(cast("dict[str, Any]", msg).get("content", ""))
                else:
                    content = str(msg)
                if self.fail_on in content:
                    should_fail = True
                    break

            async def _generator() -> AsyncIterator[str]:
                try:
                    await asyncio.sleep(self.first_byte_delay)
                    for tok in self.reasoning_tokens:
                        chunk: dict[str, Any] = {"choices": [{"delta": {"reasoning_content": tok}}]}
                        yield f"data: {json.dumps(chunk)}\n\n"
                    for tok in self.tokens:
                        chunk: dict[str, Any] = {"choices": [{"delta": {"content": tok}}]}
                        yield f"data: {json.dumps(chunk)}\n\n"
                        self.emitted += 1
                        await asyncio.sleep(self.delay)
                        if should_fail and self.emitted >= 2:
                            raise RuntimeError("fail_on triggered")
                    yield "data: [DONE]\n\n"
                finally:
                    self.closed_at = time.monotonic()

            return StreamingResponse(_generator(), media_type="text/event-stream")


def free_port() -> int:
    """Return a free port on 127.0.0.1."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))
    port: int = sock.getsockname()[1]
    sock.close()
    return port


@asynccontextmanager
async def serve(app: FastAPI, port: int | None = None) -> AsyncGenerator[str, None]:
    """Run *app* on a real loopback port so streaming is incremental."""
    if port is None:
        port = free_port()

    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning", lifespan="on")
    server = uvicorn.Server(config)
    task = asyncio.create_task(server.serve())

    deadline = time.monotonic() + 5.0
    while not server.started:
        if task.done():
            task.result()
            break
        if time.monotonic() > deadline:
            task.cancel()
            raise RuntimeError("server did not start within 5 s")
        await asyncio.sleep(0.01)

    yield f"http://127.0.0.1:{port}"

    server.should_exit = True
    try:
        await asyncio.wait_for(task, timeout=5.0)
    except TimeoutError:
        task.cancel()
