from __future__ import annotations

import hmac
import json
from collections.abc import Awaitable, Callable, MutableMapping

Scope = MutableMapping[str, object]
Message = dict[str, object]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]
ASGIApp = Callable[[Scope, Receive, Send], Awaitable[None]]


class TokenHostMiddleware:
    """Pure ASGI middleware enforcing X-DocuTeach-Token and loopback Host on /api and /_store."""

    def __init__(self, app: ASGIApp, token: str, port: int) -> None:
        self._app = app
        self._token = token
        self._port = port

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self._app(scope, receive, send)
            return

        path = str(scope.get("path", ""))
        if not (path.startswith("/api") or path.startswith("/_store")):
            await self._app(scope, receive, send)
            return

        headers: list[tuple[bytes, bytes]] = scope.get("headers", [])  # type: ignore[assignment]
        token_header: str | None = None
        host_header: str | None = None
        for key, value in headers:
            k = key.decode("latin-1")
            v = value.decode("latin-1")
            if k == "x-docuteach-token":
                token_header = v
            elif k == "host":
                host_header = v

        if token_header is None or not hmac.compare_digest(
            token_header.encode(), self._token.encode()
        ):
            await self._forbidden(send, "missing or invalid token")
            return

        if host_header is None:
            await self._forbidden(send, "missing Host header")
            return

        if not self._host_ok(host_header):
            await self._forbidden(send, "invalid Host")
            return

        await self._app(scope, receive, send)

    def _host_ok(self, host: str) -> bool:
        # Strip port from host header; keep a bracketed IPv6 literal intact
        if host.startswith("["):
            end = host.find("]")
            if end == -1:
                return False
            host_part = host[1:end]
            rest = host[end + 1 :]
            if rest and not rest.startswith(":"):
                return False
            port_part = rest[1:]
        elif ":" in host:
            host_part, _, port_part = host.rpartition(":")
        else:
            host_part = host
            port_part = ""

        if self._port == 0:
            # Accept any port on loopback hosts
            return host_part in ("127.0.0.1", "localhost", "::1")
        else:
            return host_part in ("127.0.0.1", "localhost", "::1") and port_part == str(self._port)

    async def _forbidden(self, send: Send, reason: str) -> None:
        body = json.dumps({"code": "forbidden", "message": reason}).encode()
        await send(
            {
                "type": "http.response.start",
                "status": 403,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode()),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})
