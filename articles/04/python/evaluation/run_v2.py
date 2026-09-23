"""Post-evaluation improvements (v2), checked without touching the frozen evaluation.

v2 = (a) a "greeting" / "vague" verdict with confidence < 0.5 is treated as a real
question, and (b) the Gate 5 threshold is lowered from 0.85 to 0.80.

    cd articles/04/python
    python -m evaluation.run_v2

1. test / dev: apply v2 to the recorded Jev probabilities (no API calls). Only the
   questions whose path changes (intent overridden) are run again, live.
2. holdout: 10 unseen questions (holdout.jsonl) are run live, once.

Live calls use separate *_v2 caches, so every timing in the output is real.
Results: evaluation/results/{test_v2,dev_v2,holdout}/
"""

import json
import time
from dataclasses import asdict
from pathlib import Path

from jev_rag.config import Settings
from jev_rag.gates import Gates, TypeSafeBackend
from jev_rag.gemini import GeminiEmbedder, GeminiGenerator
from jev_rag.pipeline import NO_INFO_PATTERN, JevRagPipeline
from jev_rag.retrieval import VectorIndex
from jev_rag.text import split_sentences

from evaluation.analyze import analyze
from evaluation.cache import CachedEmbedder, CachedGenerator, CachedJev, JsonlCache

HERE = Path(__file__).resolve().parent
RESULTS = HERE / "results"
DOCS = HERE.parent / "sample_docs"


def load(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


def write(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


class Live:
    """v2 pipeline + ungated baseline, with fresh caches (real timings)."""

    def __init__(self, settings: Settings):
        cache = RESULTS / "cache"
        self.settings = settings
        self.jev = CachedJev(
            TypeSafeBackend(settings.jev_model),
            JsonlCache(cache / "jev_v2.jsonl"),
            settings.jev_model,
        )
        self.embedder = CachedEmbedder(
            GeminiEmbedder(settings.embedding_model, settings.embedding_dimensions),
            JsonlCache(cache / "embeddings_v2.jsonl"),
        )
        gen_cache = JsonlCache(cache / "generations_v2.jsonl")
        self.generator = CachedGenerator(
            GeminiGenerator(settings.generation_model), gen_cache
        )
        self.baseline = CachedGenerator(
            GeminiGenerator(settings.generation_model), gen_cache, "baseline"
        )
        self.index = VectorIndex.load(RESULTS / "index.json")
        routes = json.loads((DOCS / "categories.json").read_text(encoding="utf-8"))
        routes.setdefault("general", "上記のいずれにも当てはまらない質問")
        self.pipeline = JevRagPipeline(
            self.index,
            Gates(self.jev, routes=routes),
            self.generator,
            self.embedder,
            settings,
        )

    def run(self, row: dict, with_baseline: bool = True) -> dict:
        hits_before = self.jev.hits + self.generator.hits
        answer = self.pipeline.ask(row["query"])
        if answer.status == "unavailable":
            raise SystemExit(f"Jev unavailable at {row['id']}: {answer.gates}")
        record = {
            **row,
            "status": answer.status,
            "answer": answer.text,
            "citations": [c.id for c in answer.citations],
            "claims": [asdict(c) for c in answer.claims],
            "gates": answer.gates,
            "timings_ms": {k: round(v, 1) for k, v in answer.timings_ms.items()},
            "total_ms": round(answer.total_ms, 1),
            "jev_calls": answer.jev_calls,
            "jev_tokens": answer.jev_tokens,
            "llm_tokens": answer.llm_tokens,
            "replayed": (self.jev.hits + self.generator.hits) > hits_before,
            "v2": "live",
        }
        if with_baseline:
            start = time.perf_counter()
            qvec = self.embedder.embed([row["query"]], "query")
            passages = self.index.search([row["query"]], qvec, self.settings.top_k)
            base = self.baseline.generate(
                row["query"], [p.display_text for p in passages]
            )
            base_ms = (time.perf_counter() - start) * 1000
            base_ms += self.embedder.recorded_latency_ms(row["query"], "query")
            base_claims = [
                c for c in split_sentences(base.text) if not NO_INFO_PATTERN.search(c)
            ]
            record["baseline"] = {
                "answer": base.text,
                "retrieved": [p.id for p in passages],
                "llm_tokens": base.input_tokens + base.output_tokens,
                "total_ms": round(base_ms, 1),
                "claims": base_claims,
                "jev_support": None,
            }
        return record


def needs_rerun(r: dict, s: Settings) -> bool:
    t = r["gates"]["triage"]
    return (
        t["intent"] != "knowledge_search"
        and t["intent_confidence"] < s.intent_confidence_threshold
    )


def recompute(split: str, live: Live) -> list[str]:
    """Apply v2 to recorded rows; re-run live only where the path changes."""
    s = live.settings
    rows, rerun = [], []
    for r in load(RESULTS / split / "questions.jsonl"):
        if needs_rerun(r, s):
            new = live.run(r, with_baseline=False)
            new["baseline"] = r["baseline"]  # the ungated baseline does not change
            rows.append(new)
            rerun.append(r["id"])
            continue
        for c in r["claims"]:
            if c["support"] is not None:
                c["supported"] = c["support"] >= s.support_threshold
        rows.append({**r, "v2": "recomputed"})
    write(RESULTS / f"{split}_v2" / "questions.jsonl", rows)
    claims = load(RESULTS / split / "claims.jsonl")
    write(RESULTS / f"{split}_v2" / "claims.jsonl", claims)
    return rerun


def main() -> None:
    settings = Settings()
    live = Live(settings)

    reran = {split: recompute(split, live) for split in ("test", "dev")}
    print(f"re-run live (intent overridden): {reran}")

    holdout_path = RESULTS / "holdout" / "questions.jsonl"
    done = {r["id"] for r in load(holdout_path)}
    holdout_path.parent.mkdir(parents=True, exist_ok=True)
    for row in load(HERE / "holdout.jsonl"):
        if row["id"] in done:
            continue
        rec = live.run(row)
        with holdout_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        print(f"{row['id']} {row['type']:<12} {rec['status']:<10} {row['query']}")

    thr = settings.support_threshold
    for split in ("test_v2", "holdout"):
        summary = analyze(split)
        claims = load(RESULTS / split / "claims.jsonl")
        if claims:
            # analyze() hard-codes 0.85 for the synthetic Gate 5 set; redo it at v2
            fc = [c for c in claims if not c["supported"]]
            tc = [c for c in claims if c["supported"]]
            summary["gate5_false_claims_detected"] = {
                "k": sum(c["support"] < thr for c in fc),
                "n": len(fc),
            }
            summary["gate5_true_claims_flagged"] = {
                "k": sum(c["support"] < thr for c in tc),
                "n": len(tc),
            }
        (RESULTS / split / "summary.json").write_text(
            json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"wrote {split}/summary.json")
    print(
        f"live calls: jev={live.jev.live_calls} "
        f"llm={live.generator.live_calls + live.baseline.live_calls} "
        f"embed={live.embedder.live_calls}"
    )


if __name__ == "__main__":
    main()
