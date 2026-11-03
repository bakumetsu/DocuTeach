"""Application factory for DocuTeach."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI

from docuteach.api import (
    chat_stream,
    chats_store,
    checkpoints,
    docs,
    export,
    fonts,
    lessons,
    models,
    skills,
    status,
)
from docuteach.api.export import ExportGate
from docuteach.config import Settings, check_local_llm
from docuteach.errors import install_error_handlers
from docuteach.llm.client import LlmClient
from docuteach.llm.stream import LlmService
from docuteach.logs import RequestLogMiddleware, close_logging, setup_logging
from docuteach.security import TokenHostMiddleware
from docuteach.store.library import Library


def create_app(settings: Settings) -> FastAPI:
    if not settings.token:
        raise ValueError("settings.token must not be empty")
    check_local_llm(settings)

    library = Library(settings)
    client = LlmClient(settings)
    llm_service = LlmService(settings, client)

    @asynccontextmanager  # pyright: ignore[reportDeprecated]
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        setup_logging(settings.log_dir)
        library.startup()
        try:
            yield
        finally:
            await client.aclose()

    app = FastAPI(lifespan=lifespan)
    app.state.library = library
    app.state.settings = settings
    app.state.llm_client = client
    app.state.llm = llm_service
    app.state.export_gate = ExportGate()
    hooks: list[Callable[[], None]] = []
    hooks.append(lambda: close_logging(settings.log_dir))
    app.state.shutdown_hooks = hooks
    _done: list[bool] = [False]

    def shutdown() -> None:
        if _done[0]:
            return
        _done[0] = True
        for hook in hooks:
            try:
                hook()
            except Exception:
                logging.getLogger("docuteach").exception("shutdown hook failed")

    app.state.shutdown = shutdown

    install_error_handlers(app)

    app.include_router(lessons.router, prefix="/api")
    app.include_router(docs.router, prefix="/api")
    app.include_router(checkpoints.router, prefix="/api")
    app.include_router(chats_store.router, prefix="/api")
    app.include_router(export.router, prefix="/api")
    app.include_router(models.router, prefix="/api")
    app.include_router(skills.router, prefix="/api")
    app.include_router(chat_stream.router, prefix="/api")
    app.include_router(status.router, prefix="/api")
    app.include_router(fonts.router, prefix="/api")

    # Middleware: last-added is outermost.
    # Security must be outermost, logging inner.
    app.add_middleware(RequestLogMiddleware)
    app.add_middleware(TokenHostMiddleware, token=settings.token, port=settings.port)

    return app
