from __future__ import annotations

import logging
import time
from collections.abc import Awaitable, Callable, MutableMapping
from logging.handlers import RotatingFileHandler
from pathlib import Path

Scope = MutableMapping[str, object]
Message = dict[str, object]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]
ASGIApp = Callable[[Scope, Receive, Send], Awaitable[None]]


def setup_logging(log_dir: Path) -> logging.Logger:
    logger = logging.getLogger("docuteach")
    target = str(log_dir / "backend.log")
    for h in logger.handlers:
        if isinstance(h, RotatingFileHandler) and getattr(h, "baseFilename", None) == target:
            return logger
    log_dir.mkdir(parents=True, exist_ok=True)
    handler = RotatingFileHandler(
        log_dir / "backend.log",
        maxBytes=1_048_576,
        backupCount=3,
        encoding="utf-8",
    )
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    return logger


def close_logging(log_dir: Path) -> None:
    logger = logging.getLogger("docuteach")
    target = str(log_dir / "backend.log")
    for h in list(logger.handlers):
        if isinstance(h, RotatingFileHandler) and getattr(h, "baseFilename", None) == target:
            logger.removeHandler(h)
            h.close()


class RequestLogMiddleware:
    """Pure ASGI middleware: one line per /api request. Never logs body text or user-typed names."""

    def __init__(self, app: ASGIApp) -> None:
        self._app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self._app(scope, receive, send)
            return

        path = str(scope.get("path", ""))
        if not path.startswith("/api"):
            await self._app(scope, receive, send)
            return

        method = str(scope.get("method", ""))
        start = time.monotonic()
        status = 500
        resp_bytes = 0
        req_bytes = 0

        async def send_wrapper(message: Message) -> None:
            nonlocal status, resp_bytes
            mtype = message.get("type")
            if mtype == "http.response.start":
                s = message.get("status")
                if isinstance(s, int):
                    status = s
            elif mtype == "http.response.body":
                body = message.get("body", b"")
                if isinstance(body, bytes):
                    resp_bytes += len(body)
            await send(message)

        async def receive_wrapper() -> Message:
            nonlocal req_bytes
            msg = await receive()
            body = msg.get("body", b"")
            if isinstance(body, bytes):
                req_bytes += len(body)
            return msg

        try:
            await self._app(scope, receive_wrapper, send_wrapper)
        finally:
            duration_ms = (time.monotonic() - start) * 1000.0
            lesson_id = ""
            parts = path.split("/")
            if len(parts) >= 4 and parts[2] == "lessons":
                lesson_id = parts[3]
            logger = logging.getLogger("docuteach")
            logger.info(
                "%s %s status=%d lesson=%s req=%dB resp=%dB %.1fms",
                method,
                path,
                status,
                lesson_id,
                req_bytes,
                resp_bytes,
                duration_ms,
            )
