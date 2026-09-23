"""Jev Adaptive RAG pipeline."""

import json
import re
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field, replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from .config import Settings
from .documents import Chunk
from .gates import Gates, JevUnavailable
from .gemini import Generator
from .retrieval import Embedder, VectorIndex
from .text import split_sentences, split_topics

Status = Literal["answered", "no_answer", "direct", "clarify", "unavailable"]

MESSAGES = {
    "direct": "こんにちは！社内の規程や手続きについて、知りたいことを質問してください。",
    "clarify": "ご質問の対象が特定できませんでした。どの制度・手続き・仕様について知りたいか、もう少し具体的に教えてください。",
    "no_answer": "社内の資料を確認しましたが、このご質問に答えられる記載は見つかりませんでした。担当部署へお問い合わせください。",
    "unavailable": "現在、回答の根拠を確認できないため回答を控えます。しばらくしてから再度お試しください。",
}
# Sentences that only say "not in the documents" are not factual claims to verify.
NO_INFO_PATTERN = re.compile(
    r"(記載|記述|情報)が(ありません|見当たりません|ございません)|記載されていません"
)


@dataclass
class Claim:
    text: str
    support: float | None  # Jev Yes probability; None when not verified
    supported: bool | None


@dataclass
class Answer:
    query: str
    status: Status
    text: str
    citations: list[Chunk] = field(default_factory=list)
    claims: list[Claim] = field(default_factory=list)
    gates: dict[str, Any] = field(default_factory=dict)
    timings_ms: dict[str, float] = field(default_factory=dict)
    jev_calls: int = 0
    jev_tokens: int = 0
    llm_tokens: int = 0

    @property
    def unsupported_claims(self) -> list[Claim]:
        return [c for c in self.claims if c.supported is False]

    @property
    def total_ms(self) -> float:
        return sum(self.timings_ms.values())


class JevRagPipeline:
    def __init__(
        self,
        index: VectorIndex,
        gates: Gates,
        generator: Generator,
        embedder: Embedder,
        settings: Settings | None = None,
    ):
        self.index = index
        self.gates = gates
        self.generator = generator
        self.embedder = embedder
        self.settings = settings or Settings()
        self._pool = ThreadPoolExecutor(max_workers=2)

    # ------------------------------------------------------------------
    def ask(self, query: str, user_groups: list[str] | None = None) -> Answer:
        gates = replace(self.gates, calls=[])  # per-request call log (thread-safe)
        answer = Answer(query=query, status="answered", text="")
        try:
            self._run(gates, query, user_groups, answer)
        except JevUnavailable as e:
            answer.gates["error"] = str(e)
            if self.settings.fail_mode == "closed":
                answer.status, answer.text = "unavailable", MESSAGES["unavailable"]
                answer.claims, answer.citations = [], []
            else:
                self._run_ungated(query, user_groups, answer)
        answer.jev_calls = len(gates.calls)
        answer.jev_tokens = sum(
            c.usage.get("input_tokens", 0) + c.usage.get("output_tokens", 0)
            for c in gates.calls
        )
        answer.gates["jev_models"] = sorted({c.model for c in gates.calls if c.model})
        self._audit(answer)
        return answer

    # ------------------------------------------------------------------
    def _run(
        self, gates: Gates, query: str, user_groups: list[str] | None, answer: Answer
    ) -> None:
        s = self.settings
        t = answer.timings_ms

        # Gate 1 & 2 (Jev) and the query embedding run concurrently.
        start = time.perf_counter()
        qvec_future = self._pool.submit(self.embedder.embed, [query], "query")
        triage = gates.triage(query)
        t["triage"] = _ms(start)

        if (
            triage.intent != "knowledge_search"
            and triage.intent_confidence < s.intent_confidence_threshold
        ):
            answer.gates["intent_overridden"] = triage.intent
            triage.intent = "knowledge_search"
        answer.gates["triage"] = asdict(triage)

        if triage.intent in ("direct_answer", "clarification_needed"):
            answer.status = "direct" if triage.intent == "direct_answer" else "clarify"
            answer.text = MESSAGES[answer.status]
            return

        # Retrieval (sub-queries when Gate 2 says the query is compound)
        start = time.perf_counter()
        queries = [query]
        if triage.decompose >= s.decompose_threshold:
            queries += split_topics(query)[:3]
        vectors = qvec_future.result()
        if len(queries) > 1:
            vectors += self.embedder.embed(queries[1:], "query")
        category = None
        if (
            s.use_routing
            and triage.route not in (None, "general")
            and triage.route_confidence >= s.route_confidence_threshold
        ):
            category = triage.route
        passages = self.index.search(queries, vectors, s.top_k, user_groups, category)
        t["retrieval"] = _ms(start)
        answer.gates["sub_queries"] = queries[1:]
        answer.gates["retrieved"] = [p.id for p in passages]
        if not passages:
            answer.status, answer.text = "no_answer", MESSAGES["no_answer"]
            return

        # Gate 3 & 4 (one Jev call)
        start = time.perf_counter()
        assessment = gates.assess(query, passages)
        t["assess"] = _ms(start)
        accepted = [
            p
            for p, score in zip(passages, assessment.relevance)
            if score >= s.relevance_threshold
        ]
        answer.gates["relevance"] = dict(
            zip(answer.gates["retrieved"], assessment.relevance)
        )
        answer.gates["sufficiency"] = assessment.sufficiency
        answer.gates["accepted"] = [p.id for p in accepted]
        if not accepted or assessment.sufficiency < s.sufficiency_threshold:
            answer.status, answer.text = "no_answer", MESSAGES["no_answer"]
            return

        # System Two: generate once, from accepted passages only
        start = time.perf_counter()
        generation = self.generator.generate(query, [p.display_text for p in accepted])
        t["generate"] = _ms(start)
        answer.llm_tokens = generation.input_tokens + generation.output_tokens
        answer.text = generation.text
        answer.citations = accepted

        # Gate 5 (one Jev call)
        sentences = split_sentences(generation.text)
        factual = [c for c in sentences if not NO_INFO_PATTERN.search(c)]
        supports: list[float] = []
        if factual:
            start = time.perf_counter()
            supports = gates.verify(factual, accepted)
            t["verify"] = _ms(start)
        by_text = dict(zip(factual, supports))
        answer.claims = [
            Claim(
                c,
                by_text.get(c),
                None if c not in by_text else by_text[c] >= s.support_threshold,
            )
            for c in sentences
        ]

        if s.unsupported_policy == "remove" and answer.unsupported_claims:
            kept = [c.text for c in answer.claims if c.supported is not False]
            if not kept:
                answer.status, answer.text = "no_answer", MESSAGES["no_answer"]
                answer.claims, answer.citations = [], []
            else:
                answer.text = "".join(kept)

    def _run_ungated(
        self, query: str, user_groups: list[str] | None, answer: Answer
    ) -> None:
        """fail_mode="open": answer without Jev checks (claims are left unverified)."""
        start = time.perf_counter()
        vectors = self.embedder.embed([query], "query")
        passages = self.index.search([query], vectors, self.settings.top_k, user_groups)
        generation = self.generator.generate(query, [p.display_text for p in passages])
        answer.timings_ms["ungated"] = _ms(start)
        answer.status = "answered"
        answer.text = generation.text
        answer.citations = passages
        answer.claims = [Claim(c, None, None) for c in split_sentences(generation.text)]
        answer.llm_tokens = generation.input_tokens + generation.output_tokens

    def _audit(self, answer: Answer) -> None:
        path = self.settings.audit_log_path
        if not path:
            return
        record = {
            "time": datetime.now(timezone.utc).isoformat(),
            "query": answer.query if self.settings.audit_log_query_text else None,
            "status": answer.status,
            "gates": answer.gates,
            "citations": [c.id for c in answer.citations],
            "claims": [asdict(c) for c in answer.claims],
            "timings_ms": {k: round(v) for k, v in answer.timings_ms.items()},
            "jev_calls": answer.jev_calls,
        }
        with Path(path).open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")


def _ms(start: float) -> float:
    return (time.perf_counter() - start) * 1000
