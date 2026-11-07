"""BM25 retrieval over the workspace context the backend sends.

The backend has already filtered the context to what the caller may read;
this module only ranks it. Long documents are split into overlapping
passages so a relevant paragraph is not drowned by the rest of the doc.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass

_TOKEN = re.compile(r"[a-z0-9]+(?:[-_.][a-z0-9]+)*")
_STOP = frozenset(
    [
        "a",
        "an",
        "and",
        "are",
        "as",
        "at",
        "be",
        "by",
        "for",
        "from",
        "has",
        "have",
        "how",
        "i",
        "in",
        "is",
        "it",
        "its",
        "of",
        "on",
        "or",
        "that",
        "the",
        "this",
        "to",
        "was",
        "were",
        "what",
        "when",
        "where",
        "which",
        "who",
        "why",
        "will",
        "with",
        "we",
        "our",
        "you",
        "your",
        "do",
        "does",
        "did",
    ]
)

PASSAGE_CHARS = 1200
PASSAGE_OVERLAP = 200


def tokenize(text: str) -> list[str]:
    return [t for t in _TOKEN.findall(text.lower()) if t not in _STOP]


@dataclass(frozen=True)
class Passage:
    source_id: str
    kind: str
    title: str
    text: str


@dataclass(frozen=True)
class Hit:
    passage: Passage
    score: float


def split_passages(source_id: str, kind: str, title: str, text: str) -> list[Passage]:
    text = text.strip()
    if len(text) <= PASSAGE_CHARS:
        return [Passage(source_id, kind, title, text)]
    out: list[Passage] = []
    start = 0
    while start < len(text):
        end = min(len(text), start + PASSAGE_CHARS)
        if end < len(text):
            # Prefer to break on a paragraph or sentence boundary.
            cut = max(
                text.rfind("\n", start + PASSAGE_CHARS // 2, end),
                text.rfind(". ", start + PASSAGE_CHARS // 2, end),
            )
            if cut > start:
                end = cut + 1
        out.append(Passage(source_id, kind, title, text[start:end].strip()))
        if end >= len(text):
            break
        start = max(end - PASSAGE_OVERLAP, start + 1)
    return out


class BM25:
    def __init__(self, passages: list[Passage], k1: float = 1.5, b: float = 0.75) -> None:
        self.passages = passages
        self.k1 = k1
        self.b = b
        # The title is weighted by repeating it: it is the densest signal.
        self.docs = [tokenize(f"{p.title} {p.title} {p.text}") for p in passages]
        self.lengths = [len(d) for d in self.docs]
        self.avg = (sum(self.lengths) / len(self.lengths)) if self.lengths else 0.0
        self.tf = [Counter(d) for d in self.docs]
        df: Counter[str] = Counter()
        for d in self.tf:
            df.update(d.keys())
        n = len(self.docs)
        self.idf = {t: math.log(1 + (n - c + 0.5) / (c + 0.5)) for t, c in df.items()}

    def search(self, query: str, k: int) -> list[Hit]:
        terms = tokenize(query)
        if not terms or not self.passages:
            return []
        scored: list[Hit] = []
        for i, tf in enumerate(self.tf):
            s = 0.0
            norm = self.k1 * (1 - self.b + self.b * self.lengths[i] / (self.avg or 1))
            for t in terms:
                f = tf.get(t)
                if f:
                    s += self.idf[t] * f * (self.k1 + 1) / (f + norm)
            if s > 0:
                scored.append(Hit(self.passages[i], s))
        scored.sort(key=lambda h: (-h.score, h.passage.source_id))
        return scored[:k]
