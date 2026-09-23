"""The five Jev (System One) gates, packed into at most three API calls per query.

  call 1  Gate 1 (intent, route) + Gate 2 (decompose)
  call 2  Gate 3 (relevance of every passage) + Gate 4 (sufficiency)
  call 3  Gate 5 (support of every generated sentence)

Jev bills by tokens, so asking several questions about one shared `state` is
cheaper than sending the same text in separate calls.
"""

import time
from dataclasses import dataclass, field
from typing import Any, Protocol

from .documents import Chunk

PROMPT_VERSION = "2026-09-24.1"

INTENT_CRITERIA = {
    "direct_answer": "挨拶、お礼、雑談など、社内文書を調べる必要がない入力",
    "knowledge_search": "社内の規程・制度・仕様・手続きなど、文書を調べて答えるべき具体的な質問",
    "clarification_needed": "何について聞いているのか特定できない、曖昧すぎる入力",
}
RELEVANCE_CRITERIA = [
    "0: 無関係、または質問の答えに役立つ情報を含まない",
    "1: 関連はするが、質問への直接の答えは含まない",
    "2: 質問への直接の答え（数値・条件・手順など）を含む",
]


class JevUnavailable(RuntimeError):
    """Raised when the Jev API cannot be reached or returns an error."""


class JevBackend(Protocol):
    def ask(self, state: dict[str, Any], questions: dict[str, Any]) -> dict[str, Any]:
        """Return {"answers": {key: dict}, "model": str, "usage": dict}."""


class TypeSafeBackend:
    """typesafe-sdk implementation of JevBackend."""

    def __init__(self, model: str, client: Any = None):
        from typesafe_sdk import TypeSafeClient

        self.client = client or TypeSafeClient(model=model)

    def ask(self, state: dict[str, Any], questions: dict[str, Any]) -> dict[str, Any]:
        from typesafe_sdk import Choice, Noul, Score

        types = {"choice": Choice, "score": Score, "noul": Noul}
        sdk_questions = {
            k: types[q["type"]](**{f: v for f, v in q.items() if f != "type"})
            for k, q in questions.items()
        }
        try:
            resp = self.client.system_one(state=state, questions=sdk_questions)
        except Exception as e:  # network, auth, validation, rate limit ...
            raise JevUnavailable(str(e)) from e
        return {
            "answers": {
                k: a.model_dump(exclude={"legend"}) for k, a in resp.answers.items()
            },
            "model": resp.model,
            "usage": resp.usage.model_dump() if resp.usage else {},
        }


@dataclass
class GateCall:
    """One Jev API call, kept for the audit log and for latency/cost reporting."""

    name: str
    latency_ms: float
    model: str
    usage: dict[str, Any]
    answers: dict[str, Any]


@dataclass
class Triage:
    intent: str
    intent_confidence: float
    route: str | None
    route_confidence: float
    decompose: float


@dataclass
class Assessment:
    relevance: list[float]  # expected value 0-2, aligned with the passages
    sufficiency: float  # Yes probability


@dataclass
class Gates:
    backend: JevBackend
    routes: dict[str, str] = field(default_factory=dict)  # category -> description
    calls: list[GateCall] = field(default_factory=list)

    def _ask(self, name: str, state: dict, questions: dict) -> dict[str, Any]:
        start = time.perf_counter()
        resp = self.backend.ask(state, questions)
        self.calls.append(
            GateCall(
                name=name,
                latency_ms=(time.perf_counter() - start) * 1000,
                model=resp.get("model", ""),
                usage=resp.get("usage", {}),
                answers=resp["answers"],
            )
        )
        return resp["answers"]

    def triage(self, query: str) -> Triage:
        questions: dict[str, dict] = {
            "intent": {
                "type": "choice",
                "instructions": "`query` に答えるために、社内文書を調べる必要がありますか？",
                "criteria": INTENT_CRITERIA,
            },
            "decompose": {
                "type": "noul",
                "instructions": (
                    "`query` は複数の異なる事柄（例: AとBの違い、AとBの両方）をたずねており、"
                    "事柄ごとに分けて調べる必要がありますか？"
                ),
            },
        }
        if self.routes:
            questions["route"] = {
                "type": "choice",
                "instructions": "`query` に答えるには、どの分野の文書を調べるべきですか？",
                "criteria": self.routes,
            }
        a = self._ask("triage", {"query": query}, questions)
        route = a.get("route")
        return Triage(
            intent=a["intent"]["choice"],
            intent_confidence=a["intent"]["confidence"],
            route=route["choice"] if route else None,
            route_confidence=route["confidence"] if route else 0.0,
            decompose=a["decompose"]["noul"],
        )

    def assess(self, query: str, passages: list[Chunk]) -> Assessment:
        state: dict[str, str] = {"query": query}
        questions: dict[str, dict] = {}
        for i, p in enumerate(passages, 1):
            state[f"passage_{i}"] = p.display_text
            questions[f"relevance_{i}"] = {
                "type": "score",
                "instructions": f"`passage_{i}` は `query` の答えを含んでいますか？",
                "criteria": RELEVANCE_CRITERIA,
            }
        questions["sufficient"] = {
            "type": "noul",
            "instructions": (
                "passage_1〜passage_{n} に書かれている内容だけで、`query` に正確に答えられますか？"
                "推測や一般常識で補わないと答えられない場合は No としてください。"
            ).replace("{n}", str(len(passages))),
        }
        a = self._ask("assess", state, questions)
        return Assessment(
            relevance=[
                a[f"relevance_{i}"]["score"] for i in range(1, len(passages) + 1)
            ],
            sufficiency=a["sufficient"]["noul"],
        )

    def verify(self, claims: list[str], sources: list[Chunk]) -> list[float]:
        state: dict[str, str] = {"source": "\n\n".join(p.display_text for p in sources)}
        questions: dict[str, dict] = {}
        for i, claim in enumerate(claims, 1):
            state[f"claim_{i}"] = claim
            questions[f"supported_{i}"] = {
                "type": "noul",
                "instructions": (
                    f"`claim_{i}` の内容（数値・条件・対象を含む）は、`source` に書かれている"
                    "ことだけで裏付けられますか？"
                ),
            }
        a = self._ask("verify", state, questions)
        return [a[f"supported_{i}"]["noul"] for i in range(1, len(claims) + 1)]
