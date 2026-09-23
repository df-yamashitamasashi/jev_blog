"""Wiring: build an index from a folder, and assemble a ready-to-use pipeline."""

import json
from pathlib import Path

from .config import Settings
from .documents import chunk_document, load_documents
from .gates import Gates, TypeSafeBackend
from .gemini import GeminiEmbedder, GeminiGenerator
from .pipeline import JevRagPipeline
from .retrieval import VectorIndex


def build_index(
    docs_dir: str | Path, index_path: str | Path, settings: Settings
) -> VectorIndex:
    """Load documents, chunk them, embed them and save the index as JSON.

    Put an optional `categories.json` ({"hr": "人事・労務に関する規程", ...}) in
    docs_dir to enable Gate 1 routing descriptions.
    """
    docs_dir = Path(docs_dir)
    chunks = [c for doc in load_documents(docs_dir) for c in chunk_document(doc)]
    categories_file = docs_dir / "categories.json"
    categories = (
        json.loads(categories_file.read_text(encoding="utf-8"))
        if categories_file.exists()
        else {}
    )
    embedder = GeminiEmbedder(settings.embedding_model, settings.embedding_dimensions)
    meta = {
        "embedding_model": settings.embedding_model,
        "embedding_dimensions": settings.embedding_dimensions,
        "categories": categories,
    }
    index = VectorIndex.build(chunks, embedder, meta)
    index.save(index_path)
    return index


def load_pipeline(
    index_path: str | Path, settings: Settings | None = None
) -> JevRagPipeline:
    settings = settings or Settings.from_env()
    index = VectorIndex.load(index_path)
    if index.meta.get("embedding_model") not in (None, settings.embedding_model):
        raise ValueError(
            f"index was built with {index.meta['embedding_model']}, "
            f"but settings.embedding_model is {settings.embedding_model}; re-run ingest"
        )
    routes = dict(index.meta.get("categories", {}))
    if routes:
        routes.setdefault("general", "上記のいずれにも当てはまらない質問")
    return JevRagPipeline(
        index=index,
        gates=Gates(TypeSafeBackend(settings.jev_model), routes=routes),
        generator=GeminiGenerator(settings.generation_model),
        embedder=GeminiEmbedder(
            settings.embedding_model, settings.embedding_dimensions
        ),
        settings=settings,
    )
