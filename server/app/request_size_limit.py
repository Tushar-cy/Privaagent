"""Bound HTTP request bodies before FastAPI parses JSON or base64 fields."""

import json
import tempfile

from starlette.types import ASGIApp, Message, Receive, Scope, Send


# A 64 MiB PNG expands to about 85.34 MiB in base64. Leave room for the data
# URL, disclosure fields, and manifest while still bounding request buffering.
MAX_REQUEST_BODY_BYTES = 90 * 1024 * 1024
_REPLAY_CHUNK_BYTES = 64 * 1024
_SPOOL_MEMORY_BYTES = 1024 * 1024


class RequestBodySizeLimitMiddleware:
    """Reject oversized request bodies before downstream body parsing begins."""

    def __init__(self, app: ASGIApp, max_bytes: int = MAX_REQUEST_BODY_BYTES):
        if max_bytes <= 0:
            raise ValueError("max_bytes must be positive")
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        content_lengths = [
            value for name, value in scope.get("headers", [])
            if name.lower() == b"content-length"
        ]
        if content_lengths:
            if len(content_lengths) != 1:
                await self._reject(send, 400, "Invalid Content-Length header.")
                return
            try:
                content_length = int(content_lengths[0])
            except ValueError:
                await self._reject(send, 400, "Invalid Content-Length header.")
                return
            if content_length < 0:
                await self._reject(send, 400, "Invalid Content-Length header.")
                return
            if content_length > self.max_bytes:
                await self._reject(send, 413, "Request body exceeds the configured limit.")
                return

        # Buffer to a spooled file so chunked requests are bounded without
        # keeping an entire accepted screenshot payload in process memory.
        with tempfile.SpooledTemporaryFile(max_size=_SPOOL_MEMORY_BYTES, mode="w+b") as body_file:
            body_size = 0
            while True:
                message = await receive()
                if message["type"] == "http.disconnect":
                    return
                if message["type"] != "http.request":
                    continue

                chunk = message.get("body", b"")
                body_size += len(chunk)
                if body_size > self.max_bytes:
                    await self._reject(send, 413, "Request body exceeds the configured limit.")
                    return
                body_file.write(chunk)
                if not message.get("more_body", False):
                    break

            body_file.seek(0)
            replayed_size = 0
            final_event_sent = False

            async def replay_receive() -> Message:
                nonlocal replayed_size, final_event_sent
                if replayed_size < body_size:
                    chunk = body_file.read(min(_REPLAY_CHUNK_BYTES, body_size - replayed_size))
                    replayed_size += len(chunk)
                    return {
                        "type": "http.request",
                        "body": chunk,
                        "more_body": replayed_size < body_size,
                    }
                if not final_event_sent:
                    final_event_sent = True
                    return {"type": "http.request", "body": b"", "more_body": False}
                return await receive()

            await self.app(scope, replay_receive, send)

    @staticmethod
    async def _reject(send: Send, status_code: int, detail: str) -> None:
        body = json.dumps({"detail": detail}).encode("utf-8")
        await send({
            "type": "http.response.start",
            "status": status_code,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode("ascii")),
            ],
        })
        await send({"type": "http.response.body", "body": body})
