"""Hybrid retrieval: BM25 (character bigrams) + embedding similarity, fused by RRF.

The index is a single JSON file, so no database is needed to get started.
For large corpora, replace `VectorIndex` with pgvector / Qdrant / Chroma etc.
"""

import json
import math
from collections import Counter
from dataclasses import asdict
from pathlib import Path
from typing import Protocol

from .documents import Chunk
from .text import tokens


class Embedder(Protocol):
    def embed(self, texts: list[str], kind: str) -> list[list[float]]:
        """kind is "document" or "query"."""


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


class BM25:
    def __init__(self, texts: list[str], k1: float = 1.2, b: float = 0.75):
        self.k1, self.b = k1, b
        self.docs = [Counter(tokens(t)) for t in texts]
        self.lengths = [sum(d.values()) for d in self.docs]
        self.avg_len = (sum(self.lengths) / len(self.lengths)) if self.docs else 1.0
        df: Counter = Counter()
        for d in self.docs:
            df.update(d.keys())
        n = len(self.docs)
        self.idf = {t: math.log((n - f + 0.5) / (f + 0.5) + 1.0) for t, f in df.items()}

    def scores(self, query: str) -> list[float]:
        q = set(tokens(query, strip_question=True))
        out = []
        for d, length in zip(self.docs, self.lengths):
            s = 0.0
            for t in q:
                tf = d.get(t, 0)
                if tf:
                    norm = self.k1 * (1 - self.b + self.b * length / self.avg_len)
                    s += self.idf[t] * tf * (self.k1 + 1) / (tf + norm)
            out.append(s)
        return out


class VectorIndex:
    """Chunks + embeddings, persisted as JSON."""

    def __init__(self, chunks: list[Chunk], vectors: list[list[float]], meta: dict):
        if len(chunks) != len(vectors):
            raise ValueError("chunks and vectors must have the same length")
        self.chunks = chunks
        self.vectors = vectors
        self.meta = meta
        self.bm25 = BM25([c.display_text for c in chunks])

    @classmethod
    def build(
        cls, chunks: list[Chunk], embedder: Embedder, meta: dict
    ) -> "VectorIndex":
        vectors: list[list[float]] = []
        batch = 100
        for i in range(0, len(chunks), batch):
            texts = [c.display_text for c in chunks[i : i + batch]]
            vectors.extend(embedder.embed(texts, kind="document"))
        return cls(chunks, vectors, meta)

    def save(self, path: str | Path) -> None:
        data = {
            "meta": self.meta,
            "chunks": [asdict(c) for c in self.chunks],
            "vectors": [[round(x, 6) for x in v] for v in self.vectors],
        }
        Path(path).write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

    @classmethod
    def load(cls, path: str | Path) -> "VectorIndex":
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        chunks = [Chunk(**c) for c in data["chunks"]]
        return cls(chunks, data["vectors"], data.get("meta", {}))

    def search(
        self,
        queries: list[str],
        query_vectors: list[list[float]],
        top_k: int,
        user_groups: list[str] | None = None,
        category: str | None = None,
        rrf_k: int = 60,
    ) -> list[Chunk]:
        """Reciprocal Rank Fusion over (BM25, vector) x every (sub-)query."""
        allowed = [
            i
            for i, c in enumerate(self.chunks)
            if c.visible_to(user_groups)
            and (category is None or c.category == category)
        ]
        if not allowed:
            return []
        fused: dict[int, float] = {i: 0.0 for i in allowed}
        for query, qvec in zip(queries, query_vectors):
            bm25 = self.bm25.scores(query)
            rankings = [
                # chunks with no keyword overlap get no BM25 vote at all
                sorted((i for i in allowed if bm25[i] > 0), key=lambda i: -bm25[i]),
                sorted(
                    allowed, key=lambda i: _cosine(qvec, self.vectors[i]), reverse=True
                ),
            ]
            for ranking in rankings:
                for rank, i in enumerate(ranking):
                    fused[i] += 1.0 / (rrf_k + rank + 1)
        best = sorted(allowed, key=lambda i: fused[i], reverse=True)[:top_k]
        return [self.chunks[i] for i in best]
