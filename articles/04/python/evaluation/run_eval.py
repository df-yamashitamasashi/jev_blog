"""Run the evaluation against the real Jev and Gemini APIs.

    cd articles/04/python
    python -m evaluation.run_eval --split dev    # tuning set (may be re-run)
    python -m evaluation.run_eval --split test   # final set (run once, after freezing)

Every API response is recorded under evaluation/results/cache/, and every finished
question is appended to evaluation/results/<split>/questions.jsonl. Re-running the same
command resumes where it stopped without calling the APIs again.
"""

import argparse
import json
import time
from dataclasses import asdict
from pathlib import Path

from jev_rag.config import Settings
from jev_rag.documents import chunk_document, load_documents
from jev_rag.gates import Gates, TypeSafeBackend
from jev_rag.gemini import GeminiEmbedder, GeminiGenerator
from jev_rag.pipeline import NO_INFO_PATTERN, JevRagPipeline
from jev_rag.retrieval import VectorIndex
from jev_rag.text import split_sentences

from evaluation.cache import CachedEmbedder, CachedGenerator, CachedJev, JsonlCache

HERE = Path(__file__).resolve().parent

DOCS = HERE.parent / "sample_docs"
RESULTS = HERE / "results"


def load_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


def build_components(settings: Settings):
    cache_dir = RESULTS / "cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    jev = CachedJev(
        TypeSafeBackend(settings.jev_model),
        JsonlCache(cache_dir / "jev.jsonl"),
        settings.jev_model,
    )
    embedder = CachedEmbedder(
        GeminiEmbedder(settings.embedding_model, settings.embedding_dimensions),
        JsonlCache(cache_dir / "embeddings.jsonl"),
    )
    gen_cache = JsonlCache(cache_dir / "generations.jsonl")
    generator = CachedGenerator(GeminiGenerator(settings.generation_model), gen_cache)
    baseline = CachedGenerator(
        GeminiGenerator(settings.generation_model), gen_cache, "baseline"
    )

    index_path = RESULTS / "index.json"
    if index_path.exists():
        index = VectorIndex.load(index_path)
    else:
        chunks = [c for d in load_documents(DOCS) for c in chunk_document(d)]
        index = VectorIndex.build(
            chunks, embedder, {"embedding_model": settings.embedding_model}
        )
        index.save(index_path)
    return jev, embedder, generator, baseline, index


def run_questions(split: str, settings: Settings) -> None:
    jev, embedder, generator, baseline, index = build_components(settings)
    # Same configuration as production (app.load_pipeline): the route question is
    # asked in the triage call; use_routing=False so it does not filter retrieval.
    routes = json.loads((DOCS / "categories.json").read_text(encoding="utf-8"))
    routes.setdefault("general", "上記のいずれにも当てはまらない質問")
    pipeline = JevRagPipeline(
        index, Gates(jev, routes=routes), generator, embedder, settings
    )
    out_dir = RESULTS / split
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "questions.jsonl"
    done = {r["id"] for r in load_jsonl(out_path)}
    rows = [r for r in load_jsonl(HERE / "dataset.jsonl") if r["split"] == split]

    for row in rows:
        if row["id"] in done:
            continue
        hits_before = jev.hits + generator.hits
        answer = pipeline.ask(row["query"])
        if answer.status == "unavailable":
            raise SystemExit(
                f"Jev unavailable at {row['id']}: {answer.gates.get('error')}"
            )
        replayed = (jev.hits + generator.hits) > hits_before

        # Baseline: same retrieval and LLM, no gates (every query goes to the LLM).
        start = time.perf_counter()
        qvec = embedder.embed([row["query"]], "query")
        passages = index.search([row["query"]], qvec, settings.top_k)
        base = baseline.generate(row["query"], [p.display_text for p in passages])
        # The query embedding is shared with the Jev run above (cache hit), so add
        # the latency of the live embedding call it came from.
        base_ms = (time.perf_counter() - start) * 1000
        base_ms += embedder.recorded_latency_ms(row["query"], "query")
        base_claims = [
            c for c in split_sentences(base.text) if not NO_INFO_PATTERN.search(c)
        ]

        # For questions without an answer, check the baseline's sentences with Gate 5
        # too: does Jev flag what an ungated RAG would have said?
        base_support = None
        if not row["answerable"] and base_claims:
            base_support = Gates(jev).verify(base_claims, passages)

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
            "replayed": replayed,
            "baseline": {
                "answer": base.text,
                "retrieved": [p.id for p in passages],
                "llm_tokens": base.input_tokens + base.output_tokens,
                "total_ms": round(base_ms, 1),
                "claims": base_claims,
                "jev_support": base_support,
            },
        }
        with out_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
        label = f"{row['id']} {row['type']:<12} {answer.status:<10}"
        print(f"{label} {answer.total_ms:6.0f} ms  {row['query']}")

    print(
        f"live calls: jev={jev.live_calls} "
        f"llm={generator.live_calls + baseline.live_calls} "
        f"embed={embedder.live_calls} (cache hits: jev={jev.hits})"
    )


def run_claims(split: str, settings: Settings) -> None:
    jev, *_, index = build_components(settings)
    gates = Gates(jev)
    out_path = RESULTS / split / "claims.jsonl"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if out_path.exists():
        print(f"{out_path} already exists")
        return
    rows = [r for r in load_jsonl(HERE / "claims.jsonl") if r["split"] == split]
    by_source: dict[str, list[dict]] = {}
    for r in rows:
        by_source.setdefault(r["source_evidence"], []).append(r)
    with out_path.open("w", encoding="utf-8") as f:
        for evidence, claims in by_source.items():
            source = [c for c in index.chunks if evidence in c.text]
            supports = gates.verify([c["claim"] for c in claims], source)
            for c, s in zip(claims, supports):
                f.write(
                    json.dumps(
                        {**c, "source": source[0].id, "support": s}, ensure_ascii=False
                    )
                    + "\n"
                )
    print(f"claims done: live jev calls={jev.live_calls}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--split", choices=["dev", "test"], required=True)
    parser.add_argument("--only", choices=["questions", "claims"], default=None)
    args = parser.parse_args()
    settings = Settings()
    if args.only in (None, "questions"):
        run_questions(args.split, settings)
    if args.only in (None, "claims"):
        run_claims(args.split, settings)


if __name__ == "__main__":
    main()
