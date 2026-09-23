"""Record every API response so that a crashed run can resume without re-calling.

Each wrapper appends {"key", "response", "latency_ms"} to a JSONL file and
serves later identical requests from it (`hits` counts how often that happened).
"""

import hashlib
import json
import threading
import time
from pathlib import Path
from typing import Any

from jev_rag.gemini import Generation


def _key(payload: Any) -> str:
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


class JsonlCache:
    def __init__(self, path: Path):
        self.path = path
        self.lock = threading.Lock()
        self.data: dict[str, dict] = {}
        if path.exists():
            for line in path.read_text(encoding="utf-8").splitlines():
                rec = json.loads(line)
                self.data[rec["key"]] = rec

    def get(self, key: str) -> dict | None:
        return self.data.get(key)

    def put(self, key: str, response: Any, latency_ms: float) -> None:
        rec = {"key": key, "response": response, "latency_ms": round(latency_ms, 1)}
        with self.lock:
            self.data[key] = rec
            with self.path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")


class CachedJev:
    def __init__(self, backend, cache: JsonlCache, model: str):
        self.backend, self.cache, self.model = backend, cache, model
        self.hits = 0
        self.live_calls = 0

    def ask(self, state, questions):
        key = _key({"model": self.model, "state": state, "questions": questions})
        rec = self.cache.get(key)
        if rec:
            self.hits += 1
            return rec["response"]
        start = time.perf_counter()
        resp = self.backend.ask(state, questions)
        self.live_calls += 1
        self.cache.put(key, resp, (time.perf_counter() - start) * 1000)
        return resp


class CachedGenerator:
    def __init__(self, generator, cache: JsonlCache, tag: str = ""):
        self.generator, self.cache, self.tag = generator, cache, tag
        self.hits = 0
        self.live_calls = 0

    def generate(self, query, sources):
        key = _key(
            {
                "model": self.generator.model,
                "system": self.generator.system_prompt,
                "query": query,
                "sources": sources,
                "tag": self.tag,
            }
        )
        rec = self.cache.get(key)
        if rec:
            self.hits += 1
            return Generation(**rec["response"])
        start = time.perf_counter()
        g = self.generator.generate(query, sources)
        self.live_calls += 1
        self.cache.put(key, g.__dict__, (time.perf_counter() - start) * 1000)
        return g


class CachedEmbedder:
    """Caches per text, so query embeddings are computed once across all runs."""

    def __init__(self, embedder, cache: JsonlCache):
        self.embedder, self.cache = embedder, cache
        self.hits = 0
        self.live_calls = 0

    def _keys(self, texts, kind):
        return [
            _key(
                {
                    "model": self.embedder.model,
                    "dims": self.embedder.dimensions,
                    "kind": kind,
                    "text": t,
                }
            )
            for t in texts
        ]

    def recorded_latency_ms(self, text: str, kind: str) -> float:
        """Latency of the live API call that produced this embedding."""
        return self.cache.get(self._keys([text], kind)[0])["latency_ms"]

    def embed(self, texts, kind):
        keys = self._keys(texts, kind)
        missing = [(k, t) for k, t in zip(keys, texts) if not self.cache.get(k)]
        if missing:
            start = time.perf_counter()
            vectors = self.embedder.embed([t for _, t in missing], kind)
            self.live_calls += 1
            per_item = (time.perf_counter() - start) * 1000
            for (k, _), v in zip(missing, vectors):
                self.cache.put(k, v, per_item)
        self.hits += len(texts) - len(missing)
        return [self.cache.get(k)["response"] for k in keys]
