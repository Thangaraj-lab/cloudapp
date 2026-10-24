"""Server-sent events: every audit append, ledger change and edge heartbeat is pushed
to connected browsers (laptop and phone) so screens update in real time."""
from __future__ import annotations

import asyncio
import json

_subscribers: set[asyncio.Queue] = set()
_loop: asyncio.AbstractEventLoop | None = None


def bind_loop(loop: asyncio.AbstractEventLoop) -> None:
    global _loop
    _loop = loop


def publish(kind: str, data) -> None:
    """Thread-safe: callable from sync endpoints and the executor thread."""
    if _loop is None:
        return
    msg = f"event: {kind}\ndata: {json.dumps(data)}\n\n"
    for q in list(_subscribers):
        _loop.call_soon_threadsafe(q.put_nowait, msg)


async def stream():
    q: asyncio.Queue = asyncio.Queue()
    _subscribers.add(q)
    try:
        yield "event: hello\ndata: {}\n\n"
        while True:
            try:
                yield await asyncio.wait_for(q.get(), timeout=15)
            except asyncio.TimeoutError:
                yield ": keep-alive\n\n"
    finally:
        _subscribers.discard(q)
