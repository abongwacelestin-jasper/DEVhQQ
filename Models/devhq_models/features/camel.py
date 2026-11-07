"""camelCase aliases that match the TypeScript field names exactly.

pydantic's ``to_camel`` upper-cases a letter after digits (``throughput_30d``
becomes ``throughput30D``); the backend writes ``throughput30d``.
"""

from __future__ import annotations


def camel(name: str) -> str:
    head, *rest = name.split("_")
    return head + "".join(p[:1].upper() + p[1:] for p in rest)
