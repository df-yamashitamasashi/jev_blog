"""Minimal HTTP API (FastAPI).

Authentication is out of scope: put this behind your own gateway and pass the
caller's groups (e.g. from SSO) in `user_groups`.
"""

from pathlib import Path

from .config import Settings
from .pipeline import JevRagPipeline


def create_app(
    index_or_pipeline: str | Path | JevRagPipeline, settings: Settings | None = None
):
    from fastapi import FastAPI
    from pydantic import BaseModel

    if isinstance(index_or_pipeline, JevRagPipeline):
        pipeline = index_or_pipeline
    else:
        from .app import load_pipeline

        pipeline = load_pipeline(index_or_pipeline, settings)

    app = FastAPI(title="Jev Adaptive RAG")

    class AskRequest(BaseModel):
        query: str
        user_groups: list[str] | None = None

    @app.post("/ask")
    def ask(req: AskRequest) -> dict:
        a = pipeline.ask(req.query, user_groups=req.user_groups)
        return {
            "status": a.status,
            "answer": a.text,
            "citations": [
                {
                    "index": i,
                    "doc_id": c.doc_id,
                    "title": c.doc_title,
                    "heading": c.heading,
                }
                for i, c in enumerate(a.citations, 1)
            ],
            "claims": [
                {"text": c.text, "support": c.support, "supported": c.supported}
                for c in a.claims
            ],
            "latency_ms": round(a.total_ms),
        }

    @app.get("/healthz")
    def healthz() -> dict:
        return {"ok": True, "chunks": len(pipeline.index.chunks)}

    return app
