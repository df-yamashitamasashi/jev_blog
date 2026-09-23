"""Compute metrics from eval/results/<split>/ (no API calls).

python -m evaluation.analyze --split test > evaluation/results/test/summary.json
"""

import argparse
import json
import math
import statistics
from pathlib import Path

HERE = Path(__file__).resolve().parent
RESULTS = HERE / "results"
NO_INFO_MARKERS = (
    "記載がありません",
    "記載されていません",
    "見当たりません",
    "記述がありません",
)


def load(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


def rate(hits: int, n: int) -> dict:
    """Proportion with a 95% Wilson score interval."""
    if n == 0:
        return {"k": 0, "n": 0, "rate": None, "ci95": None}
    z = 1.96
    p = hits / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return {
        "k": hits,
        "n": n,
        "rate": round(p, 3),
        "ci95": [round(centre - half, 3), round(centre + half, 3)],
    }


def pct(values: list[float], q: float) -> float | None:
    if not values:
        return None
    values = sorted(values)
    idx = min(len(values) - 1, max(0, math.ceil(q * len(values)) - 1))
    return round(values[idx])


def evidence_chunks(row: dict, chunk_text: dict[str, str]) -> list[set[str]]:
    return [
        {cid for cid, text in chunk_text.items() if all(s in text for s in group)}
        for group in row["evidence"]
    ]


def keywords_ok(text: str, groups: list[list[str]]) -> bool:
    return all(any(alt in text for alt in group) for group in groups)


def analyze(split: str) -> dict:
    rows = load(RESULTS / split / "questions.jsonl")
    index = json.loads((RESULTS / "index.json").read_text(encoding="utf-8"))
    chunk_text = {c["id"]: c["text"] for c in index["chunks"]}
    knowledge = [r for r in rows if r["expected_intent"] == "knowledge_search"]
    answerable = [r for r in rows if r["answerable"]]
    unanswerable = [
        r
        for r in rows
        if not r["answerable"] and r["expected_intent"] == "knowledge_search"
    ]

    out: dict = {"split": split, "questions": len(rows)}

    # Gate 1 & 2 ------------------------------------------------------------
    out["gate1_intent_accuracy"] = rate(
        sum(r["gates"]["triage"]["intent"] == r["expected_intent"] for r in rows),
        len(rows),
    )
    routed = [r for r in knowledge if r["expected_route"]]
    out["gate1_route_accuracy"] = rate(
        sum(r["gates"]["triage"]["route"] == r["expected_route"] for r in routed),
        len(routed),
    )
    out["gate2_decompose_accuracy"] = rate(
        sum(
            (r["gates"]["triage"]["decompose"] >= 0.75) == r["expected_decompose"]
            for r in knowledge
        ),
        len(knowledge),
    )

    # Retrieval ------------------------------------------------------------
    retrieval_hit = {}
    for r in answerable:
        groups = evidence_chunks(r, chunk_text)
        retrieved = set(r["gates"].get("retrieved", []))
        retrieval_hit[r["id"]] = all(g & retrieved for g in groups)
    out["retrieval_recall_at_k"] = rate(sum(retrieval_hit.values()), len(answerable))

    # Gate 3 ---------------------------------------------------------------
    ev_scores, other_scores, reduction = [], [], []
    for r in answerable:
        rel = r["gates"].get("relevance", {})
        ev_ids = (
            set().union(*evidence_chunks(r, chunk_text)) if r["evidence"] else set()
        )
        for cid, score in rel.items():
            (ev_scores if cid in ev_ids else other_scores).append(score)
        if rel:
            total = sum(len(chunk_text[c]) for c in rel)
            kept = sum(len(chunk_text[c]) for c in r["gates"].get("accepted", []))
            reduction.append(1 - kept / total)
    out["gate3_evidence_kept"] = rate(sum(s >= 1.0 for s in ev_scores), len(ev_scores))
    out["gate3_other_dropped"] = rate(
        sum(s < 1.0 for s in other_scores), len(other_scores)
    )
    out["gate3_context_reduction_mean"] = (
        round(statistics.mean(reduction), 3) if reduction else None
    )

    # Gate 4 / end-to-end decisions -----------------------------------------
    out["answerable_answered"] = rate(
        sum(r["status"] == "answered" for r in answerable), len(answerable)
    )
    hit_rows = [r for r in answerable if retrieval_hit[r["id"]]]
    out["answerable_answered_when_retrieved"] = rate(
        sum(r["status"] == "answered" for r in hit_rows), len(hit_rows)
    )
    out["unanswerable_blocked_by_gate"] = rate(
        sum(r["status"] == "no_answer" for r in unanswerable), len(unanswerable)
    )
    out["answer_correct"] = rate(
        sum(
            r["status"] == "answered" and keywords_ok(r["answer"], r["answer_keywords"])
            for r in answerable
        ),
        len(answerable),
    )

    # Gate 5 on real answers ---------------------------------------------------
    verified = [c for r in rows for c in r["claims"] if c["supported"] is not None]
    out["gate5_real_answer_claims_supported"] = rate(
        sum(c["supported"] for c in verified), len(verified)
    )

    # Gate 5 synthetic claims ---------------------------------------------------
    claims = load(RESULTS / split / "claims.jsonl")
    true_c = [c for c in claims if c["supported"]]
    false_c = [c for c in claims if not c["supported"]]
    out["gate5_false_claims_detected"] = rate(
        sum(c["support"] < 0.85 for c in false_c), len(false_c)
    )
    out["gate5_true_claims_flagged"] = rate(
        sum(c["support"] < 0.85 for c in true_c), len(true_c)
    )
    for kind in ("num", "add"):
        k = [c for c in false_c if c["kind"] == kind]
        out[f"gate5_false_claims_detected_{kind}"] = rate(
            sum(c["support"] < 0.85 for c in k), len(k)
        )

    # Baseline (no gates) ---------------------------------------------------------
    def says_no_info(text: str) -> bool:
        return any(m in text for m in NO_INFO_MARKERS)

    out["baseline_answer_correct"] = rate(
        sum(
            keywords_ok(r["baseline"]["answer"], r["answer_keywords"])
            for r in answerable
        ),
        len(answerable),
    )
    out["baseline_unanswerable_declined"] = rate(
        sum(says_no_info(r["baseline"]["answer"]) for r in unanswerable),
        len(unanswerable),
    )

    # Latency / cost ----------------------------------------------------------------
    live = [r for r in rows if not r["replayed"]]
    by_status: dict[str, list[float]] = {}
    for r in live:
        by_status.setdefault(r["status"], []).append(r["total_ms"])
    out["latency_ms"] = {
        s: {"n": len(v), "p50": pct(v, 0.5), "p95": pct(v, 0.95)}
        for s, v in sorted(by_status.items())
    }
    stage: dict[str, list[float]] = {}
    for r in live:
        for k, v in r["timings_ms"].items():
            stage.setdefault(k, []).append(v)
    out["stage_latency_ms"] = {
        k: {"p50": pct(v, 0.5), "p95": pct(v, 0.95)} for k, v in stage.items()
    }
    base_ms = [r["baseline"]["total_ms"] for r in live]
    out["baseline_latency_ms"] = {"p50": pct(base_ms, 0.5), "p95": pct(base_ms, 0.95)}
    ans_live = [r for r in live if r["status"] == "answered"]
    out["answered_latency_vs_baseline_ms"] = {
        "jev_p50": pct([r["total_ms"] for r in ans_live], 0.5),
        "baseline_p50": pct([r["baseline"]["total_ms"] for r in ans_live], 0.5),
    }
    out["jev_calls_per_question"] = (
        round(statistics.mean(r["jev_calls"] for r in rows), 2) if rows else None
    )
    out["jev_tokens_per_question"] = (
        round(statistics.mean(r["jev_tokens"] for r in rows)) if rows else None
    )
    out["llm_tokens_total"] = {
        "jev_pipeline": sum(r["llm_tokens"] for r in rows),
        "baseline": sum(r["baseline"]["llm_tokens"] for r in rows),
    }
    out["llm_calls"] = {
        "jev_pipeline": sum(r["status"] == "answered" for r in rows),
        "baseline": len(rows),
    }
    return out


def failures(split: str) -> list[dict]:
    """Rows worth reading by hand."""
    rows = load(RESULTS / split / "questions.jsonl")
    bad = []
    for r in rows:
        wrong_intent = r["gates"]["triage"]["intent"] != r["expected_intent"]
        blocked = r["answerable"] and r["status"] != "answered"
        passed = not r["answerable"] and r["status"] == "answered"
        wrong = (
            r["answerable"]
            and r["status"] == "answered"
            and not keywords_ok(r["answer"], r["answer_keywords"])
        )
        unsupported = any(c["supported"] is False for c in r["claims"])
        if wrong_intent or blocked or passed or wrong or unsupported:
            bad.append(
                {
                    "id": r["id"],
                    "type": r["type"],
                    "query": r["query"],
                    "status": r["status"],
                    "why": [
                        n
                        for n, f in [
                            ("intent", wrong_intent),
                            ("blocked", blocked),
                            ("passed", passed),
                            ("wrong", wrong),
                            ("unsupported", unsupported),
                        ]
                        if f
                    ],
                    "answer": r["answer"],
                    "sufficiency": r["gates"].get("sufficiency"),
                    "relevance": r["gates"].get("relevance"),
                    "claims": r["claims"],
                }
            )
    return bad


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--split", choices=["dev", "test"], required=True)
    parser.add_argument("--failures", action="store_true")
    args = parser.parse_args()
    result = failures(args.split) if args.failures else analyze(args.split)
    print(json.dumps(result, ensure_ascii=False, indent=2))
