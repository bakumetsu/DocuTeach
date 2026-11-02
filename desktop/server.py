"""ASGI server for the DocuTeach desktop launcher."""

from __future__ import annotations

import json
import mimetypes
import socket
import threading
import time
from pathlib import Path
from typing import Any

import uvicorn
from docuteach.app import create_app
from docuteach.config import Settings
from fastapi import FastAPI
from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import JSONResponse, PlainTextResponse, Response
from starlette.routing import Route

from store import Store, StoreFull

MAX_BODY = 16 * 1024 * 1024


def _content_type(name: str) -> str:
    if name.endswith((".js", ".mjs")):
        return "text/javascript"
    return mimetypes.guess_type(name)[0] or "application/octet-stream"


async def _read_body(request: Request) -> bytes | Response:
    cl = request.headers.get("content-length")
    if cl is not None:
        try:
            length = int(cl)
        except ValueError:
            return PlainTextResponse("bad content-length", status_code=400)
        if length < 0:
            return PlainTextResponse("bad content-length", status_code=400)
        if length > MAX_BODY:
            return PlainTextResponse("payload too large", status_code=413)
    return await request.body()


async def _serve_index(web_dir: Path, token: str) -> Response:
    index_path = web_dir / "index.html"
    if not await run_in_threadpool(index_path.is_file):
        return PlainTextResponse("not found", status_code=404)
    html = await run_in_threadpool(index_path.read_text, encoding="utf-8")
    meta = f'<meta name="docuteach-token" content="{token}">'
    if "<head>" in html:
        html = html.replace("<head>", f"<head>\n{meta}", 1)
    elif "<HEAD>" in html:
        html = html.replace("<HEAD>", f"<HEAD>\n{meta}", 1)
    body = html.encode("utf-8")
    return Response(
        content=body,
        status_code=200,
        media_type="text/html; charset=utf-8",
        headers={"Cache-Control": "no-store"},
    )


def build_app(settings: Settings, store: Store, web_dir: Path) -> FastAPI:
    app = create_app(settings)

    async def _get_store(request: Request) -> JSONResponse:
        data = await run_in_threadpool(store.load_all)
        return JSONResponse(data)

    async def _put_store(request: Request) -> Response:
        key: str = request.path_params["key"]
        result = await _read_body(request)
        if isinstance(result, Response):
            return result
        try:
            data = json.loads(result)
        except (json.JSONDecodeError, UnicodeDecodeError):
            return PlainTextResponse("bad body", status_code=400)
        if not isinstance(data, dict):
            return PlainTextResponse("bad body", status_code=400)
        value: Any = data.get("value")
        seq: Any = data.get("seq")
        if not isinstance(value, str) or not isinstance(seq, int):
            return PlainTextResponse("bad body", status_code=400)
        try:
            res = await run_in_threadpool(store.put, key, value, seq)
        except StoreFull:
            return PlainTextResponse("insufficient storage", status_code=507)
        if res == "stale":
            return PlainTextResponse("stale seq", status_code=409)
        return Response(status_code=204)

    async def _delete_store(request: Request) -> Response:
        key: str = request.path_params["key"]
        result = await _read_body(request)
        if isinstance(result, Response):
            return result
        try:
            data = json.loads(result)
        except (json.JSONDecodeError, UnicodeDecodeError):
            return PlainTextResponse("bad body", status_code=400)
        if not isinstance(data, dict):
            return PlainTextResponse("bad body", status_code=400)
        seq: Any = data.get("seq")
        if not isinstance(seq, int):
            return PlainTextResponse("bad body", status_code=400)
        try:
            res = await run_in_threadpool(store.delete, key, seq)
        except StoreFull:
            return PlainTextResponse("insufficient storage", status_code=507)
        if res == "stale":
            return PlainTextResponse("stale seq", status_code=409)
        return Response(status_code=204)

    async def _catch_all(request: Request) -> Response:
        path: str = request.path_params["path"]
        if ".." in path or "\\" in path:
            return PlainTextResponse("forbidden", status_code=403)
        if path == "":
            return await _serve_index(web_dir, settings.token)
        file_path = web_dir / path.lstrip("/")
        try:
            resolved = await run_in_threadpool(file_path.resolve)
        except (OSError, ValueError):
            return PlainTextResponse("not found", status_code=404)
        try:
            web_resolved = await run_in_threadpool(web_dir.resolve)
        except (OSError, ValueError):
            return PlainTextResponse("not found", status_code=404)
        if not resolved.is_relative_to(web_resolved):
            return PlainTextResponse("forbidden", status_code=403)
        if not resolved.is_file():
            return PlainTextResponse("not found", status_code=404)
        data = await run_in_threadpool(resolved.read_bytes)
        return Response(content=data, media_type=_content_type(resolved.name))

    app.router.routes.append(Route("/_store", endpoint=_get_store, methods=["GET"]))
    app.router.routes.append(Route("/_store/", endpoint=_get_store, methods=["GET"]))
    app.router.routes.append(Route("/_store/{key:path}", endpoint=_put_store, methods=["PUT"]))
    app.router.routes.append(
        Route("/_store/{key:path}", endpoint=_delete_store, methods=["DELETE"])
    )
    app.router.routes.append(Route("/{path:path}", endpoint=_catch_all, methods=["GET"]))

    return app


class BackendServer:
    def __init__(self, app: FastAPI) -> None:
        self._app: FastAPI = app
        self._server: uvicorn.Server | None = None
        self._thread: threading.Thread | None = None

    def start(self, sock: socket.socket) -> None:
        config = uvicorn.Config(
            self._app,
            log_config=None,
            access_log=False,
            lifespan="on",
        )
        server = uvicorn.Server(config)
        self._server = server
        thread = threading.Thread(target=server.run, kwargs={"sockets": [sock]}, daemon=True)
        self._thread = thread
        thread.start()
        deadline = time.monotonic() + 10.0
        while not server.started:
            if time.monotonic() > deadline:
                raise RuntimeError("server did not start within 10 seconds")
            time.sleep(0.05)

    def stop(self) -> None:
        self._app.state.shutdown()
        if self._server is not None:
            self._server.should_exit = True
        if self._thread is not None:
            self._thread.join(timeout=10)


def bind_loopback() -> socket.socket:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))
    sock.listen()
    return sock
