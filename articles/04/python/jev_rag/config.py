"""Runtime settings. Every value can be overridden with a JEV_RAG_* env var."""

import os
from dataclasses import dataclass, fields
from typing import Literal


@dataclass(frozen=True)
class Settings:
    # Models (pinned so that results are reproducible)
    jev_model: str = "jev-1.13.0"
    generation_model: str = "gemini-3.8-flash"
    embedding_model: str = "gemini-embedding-2"
    embedding_dimensions: int = 768

    # Retrieval
    top_k: int = 5
    use_routing: bool = False  # filter retrieval by the Gate 1 route decision

    # Gate thresholds
    relevance_threshold: float = 1.0  # Gate 3: Score expected value (0-2)
    sufficiency_threshold: float = 0.70  # Gate 4: Yes probability
    support_threshold: float = 0.85  # Gate 5: Yes probability
    decompose_threshold: float = 0.75  # Gate 2: Yes probability
    route_confidence_threshold: float = 0.60  # Gate 1: route confidence

    # Behaviour
    fail_mode: Literal["closed", "open"] = "closed"  # when Jev is unavailable
    unsupported_policy: Literal["flag", "remove"] = "flag"  # Gate 5 failures
    audit_log_path: str | None = None
    audit_log_query_text: bool = True

    @classmethod
    def from_env(cls, **overrides) -> "Settings":
        values = {}
        for f in fields(cls):
            raw = os.getenv(f"JEV_RAG_{f.name.upper()}")
            if raw is None:
                continue
            if f.type in (float, "float"):
                values[f.name] = float(raw)
            elif f.type in (int, "int"):
                values[f.name] = int(raw)
            elif f.type in (bool, "bool"):
                values[f.name] = raw.lower() in ("1", "true", "yes")
            else:
                values[f.name] = raw
        values.update(overrides)
        return cls(**values)
