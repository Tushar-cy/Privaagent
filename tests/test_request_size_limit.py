"""Regression tests for request-size rejection before API body parsing."""

import asyncio
import sys
from pathlib import Path

SERVER_PATH = Path(__file__).parent.parent / "server"
sys.path.insert(0, str(SERVER_PATH))

from app.request_size_limit import RequestBodySizeLimitMiddleware


def _run_middleware(middleware_factory, headers=(), messages=()):
    received = iter(messages)
    downstream_called = False
    sent = []

    async def receive():
        try:
            return next(received)
        except StopIteration:
            return {"type": "http.disconnect"}

    async def send(message):
        sent.append(message)

    async def downstream(scope, downstream_receive, downstream_send):
        nonlocal downstream_called
        downstream_called = True
        body = bytearray()
        while True:
            event = await downstream_receive()
            if event["type"] == "http.disconnect":
                break
            body.extend(event.get("body", b""))
            if not event.get("more_body", False):
                break
        await downstream_send({"type": "test.body", "body": bytes(body)})

    scope = {"type": "http", "headers": list(headers)}
    middleware = middleware_factory(downstream)
    asyncio.run(middleware(scope, receive, send))
    return downstream_called, sent


def test_rejects_oversized_content_length_before_reading_body():
    downstream_called, sent = _run_middleware(
        lambda app: RequestBodySizeLimitMiddleware(app, max_bytes=8),
        headers=[(b"content-length", b"9")],
        messages=[{"type": "http.request", "body": b""}],
    )

    assert not downstream_called
    assert sent[0]["status"] == 413


def test_rejects_oversized_streaming_body_before_downstream_parsing():
    middleware = RequestBodySizeLimitMiddleware
    downstream_called, sent = _run_middleware(
        lambda app: middleware(app, max_bytes=8),
        messages=[
            {"type": "http.request", "body": b"1234", "more_body": True},
            {"type": "http.request", "body": b"56789", "more_body": False},
        ],
    )

    assert not downstream_called
    assert sent[0]["status"] == 413


def test_replays_accepted_streaming_body_to_downstream():
    middleware = RequestBodySizeLimitMiddleware
    downstream_called, sent = _run_middleware(
        lambda app: middleware(app, max_bytes=8),
        messages=[
            {"type": "http.request", "body": b"hel", "more_body": True},
            {"type": "http.request", "body": b"lo", "more_body": False},
        ],
    )

    assert downstream_called
    assert sent == [{"type": "test.body", "body": b"hello"}]
