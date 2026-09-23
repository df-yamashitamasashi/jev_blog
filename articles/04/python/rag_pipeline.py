"""
Jev Adaptive RAG Pipeline (minimal, single-file version for reading)

For real use, see the `jev_rag` package in this folder (document loading,
embeddings, hybrid search, Gemini generation, access control, CLI, HTTP API).

5-Stage System One Gated Architecture:
  Gate 1: Intent & Route Guard (Choice)
  Gate 2: Query Decomposition (Noul)       ... Gate 1 と同じ1回の呼び出しで判定
  Gate 3: Fast Semantic Reranker & Noise Filter (Score)
  Gate 4: Context Sufficiency & Hallucination Prevention (Noul)
  Gate 5: Faithfulness & Citation Verification (Noul)

TYPESAFE_API_KEY が設定されていれば typesafe-sdk で本物の Jev を呼び出し、
未設定ならオフラインの簡易シミュレータ（文字バイグラム一致率ベース）で動作します。
回答生成（System Two）は `generator` 引数で任意の LLM 呼び出しに差し替えられます。
"""

import os
import re
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

try:
    from typesafe_sdk import (
        Choice,
        ChoiceAnswer,
        Noul,
        NoulAnswer,
        Score,
        ScoreAnswer,
        TypeSafeClient,
    )

    HAS_TYPESAFE_SDK = True
except ImportError:
    HAS_TYPESAFE_SDK = False

    # Standalone fallback dataclasses if SDK is not yet installed
    @dataclass
    class Choice:
        instructions: str
        criteria: dict[str, str]

    @dataclass
    class ChoiceAnswer:
        choice: str
        probabilities: dict[str, float]
        confidence: float
        type: str = "choice"

    @dataclass
    class Score:
        instructions: str
        criteria: list[str]

    @dataclass
    class ScoreAnswer:
        score: float
        confidence: float
        legend: dict[int, str] = field(default_factory=dict)
        probabilities: dict[int, float] = field(default_factory=dict)
        type: str = "score"

    @dataclass
    class Noul:
        instructions: str

    @dataclass
    class NoulAnswer:
        noul: float
        type: str = "noul"


# Thresholds (see the article for the trade-offs of each value)
RELEVANCE_THRESHOLD = 1.0  # Gate 3: Score expected value (0-2)
SUFFICIENCY_THRESHOLD = 0.70  # Gate 4: Yes probability
SUPPORT_THRESHOLD = 0.85  # Gate 5: Yes probability
DECOMPOSE_THRESHOLD = 0.75  # Gate 2: Yes probability
TOP_K = 5


# ----------------------------------------------------------------------
# Lightweight Japanese text matching (no morphological analyzer)
# ----------------------------------------------------------------------
_SYNONYMS = [
    (re.compile(r"有休"), "有給休暇"),
    (re.compile(r"有給(?!休暇)"), "有給休暇"),
    (re.compile(r"繰り越し|繰越し"), "繰越"),
    (re.compile(r"在宅勤務|リモートワーク|テレワーク"), "在宅勤務"),
    (re.compile(r"限度"), "上限"),
]
_QUESTION_PHRASES = re.compile(
    r"(について|を?教えてください|教えて|ですか|ますか|でしょうか|何日|何回|何時間"
    r"|いくら|どのくらい|どれくらい|ください|とは|方法)"
)
_CONTENT_RUNS = re.compile(r"[a-z0-9]+|[\u30a0-\u30ff\u3400-\u9fff]+")
_NUMERIC_FACTS = re.compile(
    r"\d[\d,]*(?:\.\d+)?\s*(?:日間|日|円|秒|時間|分|件|回|%|年|ヶ月|か月|リクエスト)?"
)


def normalize_ja(text: str) -> str:
    t = unicodedata.normalize("NFKC", text).lower()
    for pattern, replacement in _SYNONYMS:
        t = pattern.sub(replacement, t)
    return t


def content_tokens(text: str, strip_question: bool = False) -> list[str]:
    """ASCII words as-is, Kanji/Katakana runs as char bigrams (hiragana ignored)."""
    t = normalize_ja(text)
    if strip_question:
        t = _QUESTION_PHRASES.sub(" ", t)
    tokens: list[str] = []
    for run in _CONTENT_RUNS.findall(t):
        if re.fullmatch(r"[a-z0-9]+", run):
            tokens.append(run)
        elif len(run) >= 2:
            tokens.extend(run[i : i + 2] for i in range(len(run) - 1))
    return tokens


def coverage(query: str, target: str, strip_question: bool = False) -> float:
    """Fraction of unique query tokens found in the target text."""
    q = set(content_tokens(query, strip_question))
    if not q:
        return 0.0
    return len(q & set(content_tokens(target))) / len(q)


def numeric_facts(text: str) -> list[str]:
    t = unicodedata.normalize("NFKC", text)
    return [re.sub(r"[,\s]", "", m) for m in _NUMERIC_FACTS.findall(t)]


def split_sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[。！？!?])|\n+", text)
    return [p.strip() for p in parts if p and len(p.strip()) > 5]


def split_topics(query: str) -> list[str]:
    """Split a compound query ("AとBの違いは？") into topic phrases."""
    parts = re.split(r"と|及び|および|並びに|、|,|\bvs\b", query, flags=re.IGNORECASE)
    return [
        p.strip() for p in parts if len(content_tokens(p, strip_question=True)) >= 2
    ]


# ----------------------------------------------------------------------
# Offline simulator (NOT the real Jev: heuristics that mimic its output shape)
# ----------------------------------------------------------------------
class StandaloneSimulatorClient:
    """Offline System One decision simulator used when TYPESAFE_API_KEY is not set."""

    def system_one(self, state: dict[str, Any], questions: dict[str, Any]):
        answers = {}
        for k, q in questions.items():
            if isinstance(q, Score):
                answers[k] = self._score(state, q)
            elif isinstance(q, Choice):
                answers[k] = self._choice(state, q)
            elif isinstance(q, Noul):
                answers[k] = self._noul(state, q)

        class Resp:
            def __init__(self, ans):
                self.answers = ans

        return Resp(answers)

    def _choice(self, state: dict[str, Any], q: Choice) -> ChoiceAnswer:
        query = str(state.get("query", "")).lower()
        keys = list(q.criteria.keys())

        if "direct_answer" in keys:
            greetings = [
                "こんにちは",
                "おはよう",
                "はじめまして",
                "hello",
                "ありがとう",
            ]
            if any(g in query for g in greetings) and len(query) < 20:
                choice = "direct_answer"
            elif len(query.strip()) <= 3 or query.strip() in ["それ", "これ"]:
                choice = "clarification_needed"
            else:
                choice = "knowledge_search"
            return ChoiceAnswer(
                type="choice",
                choice=choice,
                probabilities={choice: 0.93},
                confidence=0.92,
            )

        # Route question
        keywords = {
            "hr": ["有給", "有休", "休暇", "手当", "在宅", "リモート"],
            "office": ["ゴミ", "喫煙", "オフィス", "フロア"],
        }
        hits = {key: sum(w in query for w in keywords.get(key, [])) for key in keys}
        best = max(hits, key=lambda key: hits[key])
        choice = best if hits[best] > 0 else "general"
        return ChoiceAnswer(
            type="choice",
            choice=choice,
            probabilities={choice: 0.9},
            confidence=0.9 if hits[best] > 0 else 0.6,
        )

    def _score(self, state: dict[str, Any], q: Score) -> ScoreAnswer:
        ref = re.search(r"passage_(\d+)", q.instructions)
        passage = state.get(f"passage_{ref.group(1)}" if ref else "passage", "")
        ratio = coverage(str(state.get("query", "")), str(passage), strip_question=True)
        if ratio >= 0.5:
            score = 1.7 + min(0.3, (ratio - 0.5) * 0.6)
        elif ratio >= 0.25:
            score = 1.0 + (ratio - 0.25) * 2
        else:
            score = max(0.05, ratio * 2)
        return ScoreAnswer(
            type="score",
            score=round(score, 2),
            confidence=0.9,
            legend={},
            probabilities={},
        )

    def _noul(self, state: dict[str, Any], q: Noul) -> NoulAnswer:
        claim_ref = re.search(r"claim_(\d+)", q.instructions)
        passages = [v for k, v in state.items() if re.fullmatch(r"passage_\d+", k)]
        if claim_ref or "claim" in state:  # Gate 5
            claim = str(
                state.get(f"claim_{claim_ref.group(1)}" if claim_ref else "claim", "")
            )
            source = str(state.get("source", ""))
            source_facts = set(numeric_facts(source))
            missing_fact = any(f not in source_facts for f in numeric_facts(claim))
            ratio = coverage(claim, source)
            noul = (
                0.12
                if missing_fact
                else 0.94
                if ratio >= 0.6
                else 0.7
                if ratio >= 0.4
                else 0.25
            )
        elif "分解" in q.instructions:  # Gate 2
            noul = 0.85 if len(split_topics(str(state.get("query", "")))) >= 2 else 0.12
        elif passages:  # Gate 4
            ratio = coverage(
                str(state.get("query", "")), "\n".join(passages), strip_question=True
            )
            noul = 0.92 if ratio >= 0.5 else 0.6 if ratio >= 0.35 else 0.12
        else:
            noul = 0.5
        return NoulAnswer(type="noul", noul=noul)


def extractive_generator(query: str, context: str) -> str:
    """
    Offline stand-in for System Two: returns the context sentences that best
    match the query.
    Replace with a real LLM call in production, e.g.:

        def call_llm(query: str, context: str) -> str:
            resp = anthropic.Anthropic().messages.create(model=..., messages=[...])
            return resp.content[0].text
    """
    sentences = [s for s in split_sentences(context) if re.search(r"[。！？]$", s)]
    topics = split_topics(query)
    queries = [query, *topics]

    selected: list[str] = []
    if len(topics) > 1:
        for topic in topics:
            ranked = sorted(
                (s for s in sentences if s not in selected),
                key=lambda s: coverage(topic, s, strip_question=True),
                reverse=True,
            )
            if ranked and coverage(topic, ranked[0], strip_question=True) >= 0.3:
                selected.append(ranked[0])

    ranked = sorted(
        (s for s in sentences if s not in selected),
        key=lambda s: max(coverage(q, s, strip_question=True) for q in queries),
        reverse=True,
    )
    for s in ranked:
        if len(selected) >= 3:
            break
        if max(coverage(q, s, strip_question=True) for q in queries) >= 0.3:
            selected.append(s)

    return "".join(selected)


# ----------------------------------------------------------------------
# Domain models
# ----------------------------------------------------------------------
@dataclass
class DocumentChunk:
    id: str
    doc_title: str
    category: str
    text: str


@dataclass
class RerankedPassage:
    chunk: DocumentChunk
    relevance_score: float
    confidence: float
    is_accepted: bool


@dataclass
class VerifiedClaim:
    claim: str
    is_supported: bool
    support_score: float


@dataclass
class RagPipelineResult:
    query: str
    final_answer: str
    is_direct_answer: bool
    is_clarification_needed: bool
    is_fallback: bool
    attribution_score: int | None  # 0-100 %, None when no LLM answer was generated
    context_reduction_percent: int | None  # None when retrieval was skipped
    llm_called: bool
    sub_queries: list[str] = field(default_factory=list)
    reranked_passages: list[RerankedPassage] = field(default_factory=list)
    accepted_passages: list[RerankedPassage] = field(default_factory=list)
    verified_claims: list[VerifiedClaim] = field(default_factory=list)


# ----------------------------------------------------------------------
# Pipeline
# ----------------------------------------------------------------------
class JevAdaptiveRagPipeline:
    def __init__(
        self,
        client: Any = None,
        generator: Callable[[str, str], str] = extractive_generator,
        documents: list[DocumentChunk] | None = None,
    ):
        if client is not None:
            self.client = client
        elif HAS_TYPESAFE_SDK and os.getenv("TYPESAFE_API_KEY"):
            self.client = TypeSafeClient()
        else:
            self.client = StandaloneSimulatorClient()
        self.generator = generator
        self.documents = (
            documents if documents is not None else self._load_default_documents()
        )

    def _load_default_documents(self) -> list[DocumentChunk]:
        return [
            DocumentChunk(
                id="hr_01_c1",
                doc_title="社内就業規程・休暇制度",
                category="hr",
                text=(
                    "正社員は入社半年後に10日間の年次有給休暇が付与されます。"
                    "勤続年数に応じて毎年最大20日まで付与日数が増加します。"
                ),
            ),
            DocumentChunk(
                id="hr_01_c2",
                doc_title="社内就業規程・休暇制度",
                category="hr",
                text=(
                    "未使用の有給休暇は、翌年度に限り1年間の繰り越しが認められます。"
                    "ただし繰り越し可能な日数は最大20日を限度とし、それを超える日数は失効します。"
                ),
            ),
            DocumentChunk(
                id="hr_01_c3",
                doc_title="社内就業規程・休暇制度",
                category="hr",
                text=(
                    "社員は本人の結婚時に5日の慶弔休暇を取得できます。"
                    "また夏季特別休暇として毎年7月〜9月の間に3日付与されます。"
                ),
            ),
            DocumentChunk(
                id="hr_02_c1",
                doc_title="リモートワーク及び手当規程",
                category="hr",
                text=(
                    "在宅勤務の光熱費・通信費の補助として、"
                    "対象者に月額一律5,000円のリモートワーク手当を支給します。"
                ),
            ),
            DocumentChunk(
                id="office_01",
                doc_title="オフィスルール",
                category="office",
                text=(
                    "毎週金曜日の夕方にフロアのゴミ箱をまとめて回収します。"
                    "執務室での喫煙は固く禁止されています。"
                ),
            ),
        ]

    def retrieve(
        self, queries: list[str], category: str | None, top_k: int = TOP_K
    ) -> list[DocumentChunk]:
        """Keyword-overlap retrieval (use BM25 / vector search in production)."""
        pool = [
            d for d in self.documents if category is None or d.category == category
        ] or self.documents
        best: dict[str, float] = {}
        for q in queries:
            for d in pool:
                best[d.id] = max(best.get(d.id, 0.0), coverage(q, d.text, True))
        ranked = sorted(pool, key=lambda d: best[d.id], reverse=True)
        return ranked[:top_k]

    def run(self, query: str) -> RagPipelineResult:
        # ----------------------------------------------------
        # GATE 1 & 2: Intent triage, routing and decomposition (one Jev call)
        # ----------------------------------------------------
        triage_resp = self.client.system_one(
            state={"query": query},
            questions={
                "intent": Choice(
                    instructions="クエリは社内文書の検索が必要ですか？それとも挨拶、または聞き返しが必要ですか？",
                    criteria={
                        "direct_answer": "挨拶、お礼、日常会話などドキュメント検索が不要な入力",
                        "knowledge_search": "社内規程、仕様、制度など知識検索を求める具体的な質問",
                        "clarification_needed": "質問が曖昧で文脈が不足しており聞き返しが必要な入力",
                    },
                ),
                "route": Choice(
                    instructions="クエリに答えるには、どのカテゴリの文書を検索すべきですか？",
                    criteria={
                        "hr": "休暇、手当、在宅勤務など人事・労務に関する質問",
                        "office": "オフィスの利用ルールに関する質問",
                        "general": "上記のいずれにも明確に当てはまらない質問",
                    },
                ),
                "decompose": Noul(
                    instructions="クエリは複数のトピック比較を含み、サブクエリに分解する必要がありますか？"
                ),
            },
        )
        intent = triage_resp.answers["intent"].choice

        if intent in ("direct_answer", "clarification_needed"):
            answer = (
                "こんにちは！社内規程や制度について何でもお尋ねください。"
                if intent == "direct_answer"
                else "ご質問の対象が特定できませんでした。具体的にどの制度やドキュメントについてでしょうか？"
            )
            return RagPipelineResult(
                query=query,
                final_answer=answer,
                is_direct_answer=intent == "direct_answer",
                is_clarification_needed=intent == "clarification_needed",
                is_fallback=False,
                attribution_score=None,
                context_reduction_percent=None,
                llm_called=False,
            )

        route = triage_resp.answers["route"]
        category = (
            route.choice
            if route.choice != "general" and route.confidence >= 0.6
            else None
        )
        sub_queries = [query]
        if triage_resp.answers["decompose"].noul >= DECOMPOSE_THRESHOLD:
            sub_queries += split_topics(query)[:3]

        # ----------------------------------------------------
        # RETRIEVAL
        # ----------------------------------------------------
        candidates = self.retrieve(sub_queries, category)

        # ----------------------------------------------------
        # GATE 3 & 4: relevance of every passage + sufficiency (one Jev call)
        # ----------------------------------------------------
        state = {"query": query}
        questions: dict[str, Any] = {}
        for i, chunk in enumerate(candidates, 1):
            state[f"passage_{i}"] = f"【{chunk.doc_title}】\n{chunk.text}"
            questions[f"relevance_{i}"] = Score(
                instructions=f"`passage_{i}` は `query` の答えを含んでいますか？",
                criteria=[
                    "0: 無関係、または質問の答えに役立つ情報を含まない",
                    "1: 関連はするが、質問への直接の答えは含まない",
                    "2: 質問への直接の答え（数値・条件・手順など）を含む",
                ],
            )
        questions["sufficient"] = Noul(
            instructions=(
                f"passage_1〜passage_{len(candidates)} に書かれている内容だけで、"
                "`query` に正確に答えられますか？"
                "推測や一般常識で補わないと答えられない場合は No としてください。"
            )
        )
        assess = self.client.system_one(state=state, questions=questions).answers

        reranked = [
            RerankedPassage(
                chunk=chunk,
                relevance_score=assess[f"relevance_{i}"].score,
                confidence=assess[f"relevance_{i}"].confidence,
                is_accepted=assess[f"relevance_{i}"].score >= RELEVANCE_THRESHOLD,
            )
            for i, chunk in enumerate(candidates, 1)
        ]
        reranked.sort(key=lambda p: p.relevance_score, reverse=True)
        accepted = [p for p in reranked if p.is_accepted]
        initial_chars = sum(len(c.text) for c in candidates)
        accepted_chars = sum(len(p.chunk.text) for p in accepted)
        reduction = (
            round((initial_chars - accepted_chars) / initial_chars * 100)
            if initial_chars
            else 0
        )
        is_sufficient = bool(accepted) and (
            assess["sufficient"].noul >= SUFFICIENCY_THRESHOLD
        )

        if not is_sufficient:
            return RagPipelineResult(
                query=query,
                final_answer=(
                    "社内ナレッジベースを確認しましたが、該当する客観的な根拠や情報は見当たりませんでした。"
                    "（根拠がないため回答の生成をスキップしました）"
                ),
                is_direct_answer=False,
                is_clarification_needed=False,
                is_fallback=True,
                attribution_score=None,
                context_reduction_percent=reduction,
                llm_called=False,
                sub_queries=sub_queries,
                reranked_passages=reranked,
                accepted_passages=accepted,
            )

        # ----------------------------------------------------
        # SYSTEM TWO: Grounded Generation (LLM, called once)
        # ----------------------------------------------------
        context_text = "\n\n".join(
            f"【{p.chunk.doc_title}】\n{p.chunk.text}" for p in accepted
        )
        answer = self.generator(query, context_text)
        claims = split_sentences(answer)

        # ----------------------------------------------------
        # GATE 5: Faithfulness & Citation Verification (one Jev call)
        # ----------------------------------------------------
        verified_claims: list[VerifiedClaim] = []
        if claims:
            state = {"source": context_text}
            questions = {}
            for i, claim in enumerate(claims, 1):
                state[f"claim_{i}"] = claim
                questions[f"supported_{i}"] = Noul(
                    instructions=(
                        f"`claim_{i}` の内容（数値・条件・対象を含む）は、"
                        "`source` に書かれていることだけで裏付けられますか？"
                    )
                )
            verify = self.client.system_one(state=state, questions=questions).answers
            for i, claim in enumerate(claims, 1):
                noul_val = verify[f"supported_{i}"].noul
                verified_claims.append(
                    VerifiedClaim(
                        claim=claim,
                        is_supported=noul_val >= SUPPORT_THRESHOLD,
                        support_score=noul_val,
                    )
                )

        passed = sum(1 for c in verified_claims if c.is_supported)
        attribution = (
            round(passed / len(verified_claims) * 100) if verified_claims else None
        )

        return RagPipelineResult(
            query=query,
            final_answer=answer,
            is_direct_answer=False,
            is_clarification_needed=False,
            is_fallback=False,
            attribution_score=attribution,
            context_reduction_percent=reduction,
            llm_called=True,
            sub_queries=sub_queries,
            reranked_passages=reranked,
            accepted_passages=accepted,
            verified_claims=verified_claims,
        )


if __name__ == "__main__":
    pipeline = JevAdaptiveRagPipeline()
    queries = [
        "こんにちは！",
        "有休の繰り越し上限は何日ですか？",
        "有給休暇と特別休暇の違いは？",
        "社内の宇宙旅行手当について教えてください",
    ]

    for q in queries:
        print(f"\n====================\nQuery: {q}\n====================")
        res = pipeline.run(q)
        print(
            f"DirectAnswer: {res.is_direct_answer} | Fallback: {res.is_fallback} | "
            f"LLM called: {res.llm_called}"
        )
        if len(res.sub_queries) > 1:
            print(f"Sub-queries: {res.sub_queries[1:]}")
        attribution = (
            "-" if res.attribution_score is None else f"{res.attribution_score}%"
        )
        reduction = (
            "-"
            if res.context_reduction_percent is None
            else f"{res.context_reduction_percent}%"
        )
        print(f"Context Reduction: {reduction} | Attribution Score: {attribution}")
        print(f"Answer: {res.final_answer}")
