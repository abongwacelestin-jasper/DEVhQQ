"""Request signing shared with the Node backend (``Backend/integrations/ml/signing.ts``).

Canonical string (UTF-8, ``\\n``-joined)::

    v1
    <unix seconds>
    <nonce>
    <METHOD>
    <path including ?query>
    <raw body>

Signature header: ``X-DevHQ-Signature: v1=<hex hmac-sha256>``, with
``X-DevHQ-Timestamp`` and ``X-DevHQ-Nonce``. Requests outside a 5-minute skew
are refused, as is a (timestamp, nonce) pair already seen in that window, so
a captured request cannot be replayed. Comparison is constant-time.

The ASGI middleware verifies the signature *before* routing or body parsing,
so an unauthenticated caller learns nothing about schemas (always 401).
"""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import time
from collections import OrderedDict
from collections.abc import Awaitable, Callable, MutableMapping
from typing import Any

SIGNATURE_HEADER = "x-devhq-signature"
TIMESTAMP_HEADER = "x-devhq-timestamp"
NONCE_HEADER = "x-devhq-nonce"
VERSION = "v1"
MAX_NONCE_LENGTH = 64

Scope = MutableMapping[str, Any]
Message = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]
ASGIApp = Callable[[Scope, Receive, Send], Awaitable[None]]


def canonical(timestamp: str, nonce: str, method: str, path: str, body: bytes) -> bytes:
    head = "\n".join([VERSION, timestamp, nonce, method.upper(), path]).encode()
    return head + b"\n" + body


def sign(token: str, timestamp: str, nonce: str, method: str, path: str, body: bytes = b"") -> str:
    digest = hmac.new(
        token.encode(), canonical(timestamp, nonce, method, path, body), hashlib.sha256
    ).hexdigest()
    return f"{VERSION}={digest}"


def signed_headers(token: str, method: str, path: str, body: bytes = b"") -> dict[str, str]:
    """Headers for an outgoing signed request (used by the training CLI to pull the export)."""
    ts = str(int(time.time()))
    nonce = secrets.token_hex(16)
    return {
        "X-DevHQ-Timestamp": ts,
        "X-DevHQ-Nonce": nonce,
        "X-DevHQ-Signature": sign(token, ts, nonce, method, path, body),
    }


class ReplayCache:
    """Bounded memory of recently accepted nonces."""

    def __init__(self, ttl_seconds: int, max_entries: int = 50_000) -> None:
        self.ttl = ttl_seconds
        self.max_entries = max_entries
        self._seen: OrderedDict[str, float] = OrderedDict()

    def check_and_add(self, key: str, now: float) -> bool:
        """True if the key is new (and records it); False if it is a replay."""
        while self._seen:
            oldest_key, at = next(iter(self._seen.items()))
            if now - at <= 2 * self.ttl and len(self._seen) < self.max_entries:
                break
            self._seen.pop(oldest_key)
        if key in self._seen:
            return False
        self._seen[key] = now
        return True


class AuthError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def verify(
    token: str | None,
    headers: dict[str, str],
    method: str,
    path: str,
    body: bytes,
    *,
    max_skew: int,
    replay: ReplayCache | None,
    now: float | None = None,
) -> None:
    if not token:
        raise AuthError(503, "integration_unconfigured", "ML_SERVICE_TOKEN is not configured")
    sig = headers.get(SIGNATURE_HEADER, "")
    ts = headers.get(TIMESTAMP_HEADER, "")
    nonce = headers.get(NONCE_HEADER, "")
    if not sig or not ts or not nonce:
        raise AuthError(401, "unauthenticated", "Signed request required")
    if not ts.isdigit() or len(nonce) > MAX_NONCE_LENGTH:
        raise AuthError(401, "unauthenticated", "Malformed signature headers")
    current = time.time() if now is None else now
    if abs(current - int(ts)) > max_skew:
        raise AuthError(401, "signature_expired", "Request timestamp outside the allowed skew")
    expected = sign(token, ts, nonce, method, path, body)
    if not hmac.compare_digest(expected.encode(), sig.encode()):
        raise AuthError(401, "bad_signature", "Signature mismatch")
    if replay is not None and not replay.check_and_add(f"{ts}:{nonce}", current):
        raise AuthError(401, "replayed", "Request already processed")


class SignatureMiddleware:
    """Pure ASGI middleware: every HTTP path except the public ones must be signed."""

    def __init__(
        self,
        app: ASGIApp,
        *,
        token_getter: Callable[[], str | None],
        max_skew: int,
        max_body_bytes: int,
        public_paths: frozenset[str] = frozenset({"/health"}),
    ) -> None:
        self.app = app
        self.token_getter = token_getter
        self.max_skew = max_skew
        self.max_body_bytes = max_body_bytes
        self.public_paths = public_paths
        self.replay = ReplayCache(max_skew)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["path"] in self.public_paths:
            await self.app(scope, receive, send)
            return

        chunks: list[bytes] = []
        size = 0
        more = True
        while more:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            size += len(chunk)
            if size > self.max_body_bytes:
                await _reject(send, 413, "payload_too_large", "Request body too large")
                return
            chunks.append(chunk)
            more = bool(message.get("more_body", False))
        body = b"".join(chunks)

        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope["headers"]}
        query = scope.get("query_string", b"").decode("latin-1")
        path = scope["path"] + (f"?{query}" if query else "")
        try:
            verify(
                self.token_getter(),
                headers,
                scope["method"],
                path,
                body,
                max_skew=self.max_skew,
                replay=self.replay,
            )
        except AuthError as e:
            await _reject(send, e.status, e.code, e.message)
            return

        sent = False

        async def replay_body() -> Message:
            nonlocal sent
            if sent:
                return {"type": "http.disconnect"}
            sent = True
            return {"type": "http.request", "body": body, "more_body": False}

        await self.app(scope, replay_body, send)


async def _reject(send: Send, status: int, code: str, message: str) -> None:
    payload = json.dumps({"error": {"code": code, "message": message}}).encode()
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(payload)).encode()),
            ],
        }
    )
    await send({"type": "http.response.body", "body": payload})
