"""Export recorded evaluation runs for the Workbench "実測リプレイ" view.

    cd articles/04/python
    python -m evaluation.export_replays

Writes ../jev-rag-workbench/public/replays.json (no API calls).
"""

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
RESULTS = HERE / "results"
OUT = HERE.parent.parent / "jev-rag-workbench" / "public" / "replays.json"


def load(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


def main() -> None:
    index = json.loads((RESULTS / "index.json").read_text(encoding="utf-8"))
    chunks = {c["id"]: c for c in index["chunks"]}
    records = []
    for split in ("test", "dev"):
        for r in load(RESULTS / split / "questions.jsonl"):
            g = r["gates"]
            accepted = set(g.get("accepted", []))
            # Rows served from the response cache have no real timings (dev re-runs)
            live = not r["replayed"]
            records.append(
                {
                    "id": r["id"],
                    "split": split,
                    "type": r["type"],
                    "query": r["query"],
                    "answerable": r["answerable"],
                    "status": r["status"],
                    "answer": r["answer"],
                    "triage": g["triage"],
                    "subQueries": g.get("sub_queries") or [],
                    "retrieved": [
                        {
                            "id": cid,
                            "title": chunks[cid]["doc_title"],
                            "heading": chunks[cid]["heading"],
                            "text": chunks[cid]["text"],
                            "relevance": g.get("relevance", {}).get(cid),
                            "accepted": cid in accepted,
                        }
                        for cid in g.get("retrieved", [])
                    ],
                    "sufficiency": g.get("sufficiency"),
                    "claims": r["claims"],
                    "citations": r["citations"],
                    "timingsMs": r["timings_ms"] if live else {},
                    "totalMs": r["total_ms"] if live else None,
                    "jevCalls": r["jev_calls"],
                    "jevTokens": r["jev_tokens"],
                    "llmTokens": r["llm_tokens"],
                    "baseline": {
                        "answer": r["baseline"]["answer"],
                        "totalMs": r["baseline"]["total_ms"] if live else None,
                        "llmTokens": r["baseline"]["llm_tokens"],
                    },
                }
            )
    data = {
        "meta": {
            "jevModel": "jev-1.13.0",
            "generationModel": "gemini-3.8-flash",
            "embeddingModel": "gemini-embedding-2",
            "thresholds": {"relevance": 1.0, "sufficiency": 0.7, "support": 0.85},
            "note": "本物の Jev / Gemini API で実行した評価の記録（test 60問＋調整用 dev 8問）",
        },
        "records": records,
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {len(records)} records -> {OUT}")


if __name__ == "__main__":
    main()
