"""Grounded assistant: retrieve from caller-scoped context, then ask Claude.

The ML service never fetches workspace data for the assistant. The backend
sends only records the caller can read (``Backend/routes/assistant.routes.ts``);
this module ranks them, builds a prompt that treats them as data, and calls
the Anthropic API with a hard token cap and timeout.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Protocol, cast

import anthropic

from ..api.schemas import AssistantRequest, AssistantResponse, SourceOut
from ..config import Settings
from .prompt import ANSWER_SCHEMA, SYSTEM_PROMPT, build_user_message
from .retrieval import BM25, split_passages

log = logging.getLogger("devhq_models.assistant")

TOP_K = 8
MAX_CONTEXT_CHARS = 16_000
FALLBACK_BETA = "server-side-fallback-2026-07-01"
#: Models that accept the server-side ``fallbacks: "default"`` form on the Claude API.
FALLBACK_MODELS = frozenset(
    {"claude-sonnet-5-5", "claude-opus-5-5", "claude-opus-5", "claude-fable-5-1"}
)


class AssistantError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


class _BetaMessages(Protocol):
    async def create(self, **kwargs: Any) -> Any: ...  # noqa: ANN401 - SDK response object


class _Beta(Protocol):
    @property
    def messages(self) -> _BetaMessages: ...


class ClaudeClient(Protocol):
    @property
    def beta(self) -> _Beta: ...


ClientFactory = Callable[[Settings], ClaudeClient]


def default_client(settings: Settings) -> ClaudeClient:
    # The key is passed explicitly so the service never falls back to an
    # on-disk profile inside the container.
    client = anthropic.AsyncAnthropic(
        api_key=settings.anthropic_api_key,
        timeout=settings.assistant_timeout_seconds,
        max_retries=1,
    )
    # The SDK client satisfies the narrow protocol this module uses (beta.messages.create).
    return cast("ClaudeClient", client)


@dataclass
class Retrieved:
    records: list[dict[str, str]]
    by_id: dict[str, SourceOut]


def retrieve(req: AssistantRequest) -> Retrieved:
    passages = [
        p for item in req.context for p in split_passages(item.id, item.kind, item.title, item.text)
    ]
    hits = BM25(passages).search(req.question, TOP_K)
    meta = {item.id: item for item in req.context}
    records: list[dict[str, str]] = []
    by_id: dict[str, SourceOut] = {}
    used = 0
    for h in hits:
        p = h.passage
        if used + len(p.text) > MAX_CONTEXT_CHARS:
            continue
        used += len(p.text)
        records.append({"id": p.source_id, "kind": p.kind, "title": p.title, "text": p.text})
        item = meta[p.source_id]
        by_id[p.source_id] = SourceOut(id=item.id, kind=item.kind, title=item.title, url=item.url)
    return Retrieved(records=records, by_id=by_id)


class AssistantService:
    def __init__(self, settings: Settings, client_factory: ClientFactory = default_client) -> None:
        self.settings = settings
        self._factory = client_factory
        self._client: ClaudeClient | None = None

    @property
    def configured(self) -> bool:
        return bool(self.settings.anthropic_api_key)

    def _get_client(self) -> ClaudeClient:
        if self._client is None:
            self._client = self._factory(self.settings)
        return self._client

    def request_params(self, req: AssistantRequest, found: Retrieved) -> dict[str, Any]:
        model = self.settings.assistant_model
        params: dict[str, Any] = {
            "model": model,
            "max_tokens": self.settings.assistant_max_tokens,
            "system": SYSTEM_PROMPT,
            "messages": [
                {"role": "user", "content": build_user_message(found.records, req.question)}
            ],
            "output_config": {
                "effort": "low",
                "format": {"type": "json_schema", "schema": ANSWER_SCHEMA},
            },
        }
        if self.settings.assistant_fallbacks and model in FALLBACK_MODELS:
            # On a safety decline the API re-runs the request on a fallback model.
            params["betas"] = [FALLBACK_BETA]
            params["fallbacks"] = "default"
        return params

    async def answer(self, req: AssistantRequest) -> AssistantResponse:
        if not self.configured:
            raise AssistantError(
                503, "integration_unconfigured", "The assistant is not configured (no API key)."
            )
        found = retrieve(req)
        params = self.request_params(req, found)
        try:
            resp = await self._get_client().beta.messages.create(**params)
        except anthropic.AuthenticationError as e:
            log.error("assistant auth failed: %s", e.message)
            raise AssistantError(
                503, "integration_misconfigured", "Assistant credentials were rejected."
            ) from e
        except anthropic.PermissionDeniedError as e:
            raise AssistantError(
                503, "integration_misconfigured", "Assistant key lacks permission."
            ) from e
        except anthropic.RateLimitError as e:
            raise AssistantError(
                503, "assistant_busy", "The assistant is busy; try again shortly."
            ) from e
        except anthropic.BadRequestError as e:
            log.error("assistant request rejected: %s", e.message)
            raise AssistantError(
                502, "assistant_rejected", "The assistant could not process this question."
            ) from e
        except anthropic.APIStatusError as e:
            raise AssistantError(
                502, "assistant_upstream", f"Assistant upstream error ({e.status_code})."
            ) from e
        except anthropic.APITimeoutError as e:
            raise AssistantError(
                504, "assistant_timeout", "The assistant took too long to answer."
            ) from e
        except anthropic.APIConnectionError as e:
            raise AssistantError(
                502, "assistant_unreachable", "Could not reach the assistant."
            ) from e

        stop = getattr(resp, "stop_reason", None)
        served_by = str(getattr(resp, "model", params["model"]))
        if stop == "refusal":
            return AssistantResponse(
                answer="I can't help with that request.",
                sources=[],
                model=served_by,
                stop_reason=stop,
                grounded=False,
            )
        text = "".join(b.text for b in resp.content if getattr(b, "type", None) == "text")
        try:
            parsed = json.loads(text)
            answer = str(parsed["answer"]).strip()
            cited = [str(s) for s in parsed.get("source_ids", [])]
        except (ValueError, KeyError, TypeError):
            if stop == "max_tokens":
                return AssistantResponse(
                    answer="The answer was cut off. Try a narrower question.",
                    sources=[],
                    model=served_by,
                    stop_reason=stop,
                    grounded=False,
                    truncated=True,
                )
            raise AssistantError(
                502, "assistant_malformed", "The assistant returned an unreadable answer."
            ) from None
        # Only ids that were actually retrieved for this caller can be cited.
        sources: list[SourceOut] = []
        for sid in cited:
            src = found.by_id.get(sid)
            if src and src not in sources:
                sources.append(src)
        return AssistantResponse(
            answer=answer[:4000],
            sources=sources,
            model=served_by,
            stop_reason=stop,
            grounded=bool(sources),
            truncated=stop == "max_tokens",
        )
