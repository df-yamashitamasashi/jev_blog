"""Offline tests for the jev_rag package (no API keys, no network)."""

import json
import zlib
from types import SimpleNamespace

import pytest
from jev_rag.config import Settings
from jev_rag.documents import Document, chunk_document, load_documents
from jev_rag.gates import Gates, JevUnavailable
from jev_rag.gemini import Generation
from jev_rag.pipeline import JevRagPipeline
from jev_rag.retrieval import VectorIndex
from jev_rag.text import split_sentences, split_topics, tokens

# ----------------------------------------------------------------------
# Fakes
# ----------------------------------------------------------------------


class FakeEmbedder:
    """Hashed bag-of-bigrams: deterministic and good enough for keyword queries."""

    def embed(self, texts, kind):
        out = []
        for t in texts:
            v = [0.0] * 64
            for tok in tokens(t):
                v[zlib.crc32(tok.encode()) % 64] += 1.0
            out.append(v)
        return out


class FakeJev:
    """Scripted Jev: relevance/support by keyword overlap, intent by simple rules."""

    def __init__(self, fail=False):
        self.fail = fail
        self.calls = []

    def ask(self, state, questions):
        if self.fail:
            raise JevUnavailable("boom")
        self.calls.append((state, questions))
        answers = {}
        query = state.get("query", "")
        for key in questions:
            if key == "intent":
                choice = (
                    "direct_answer"
                    if "こんにちは" in query
                    else "clarification_needed"
                    if len(query) <= 3
                    else "knowledge_search"
                )
                answers[key] = {"choice": choice, "confidence": 0.9}
            elif key == "route":
                answers[key] = {"choice": "hr", "confidence": 0.9}
            elif key == "decompose":
                answers[key] = {"noul": 0.9 if len(split_topics(query)) >= 2 else 0.1}
            elif key.startswith("relevance_"):
                passage = state[f"passage_{key.split('_')[1]}"]
                q_toks = set(tokens(query, strip_question=True))
                hit = len(q_toks & set(tokens(passage))) / max(1, len(q_toks))
                answers[key] = {"score": 2.0 * hit}
            elif key == "sufficient":
                answers[key] = {"noul": 0.1 if "宇宙" in query else 0.9}
            elif key.startswith("supported_"):
                claim = state[f"claim_{key.split('_')[1]}"]
                answers[key] = {"noul": 0.1 if "100日" in claim else 0.95}
        return {"answers": answers, "model": "fake-jev", "usage": {"input_tokens": 10}}


class FakeGenerator:
    def __init__(self, text=None):
        self.text = text
        self.calls = 0

    def generate(self, query, sources):
        self.calls += 1
        text = self.text or "".join(s.split("\n", 1)[1] for s in sources[:1])
        return Generation(text=text, input_tokens=100, output_tokens=20, model="fake")


DOCS = {
    "leave.md": """---
title: 休暇規程
category: hr
---
# 休暇規程
## 第3条 有給休暇の繰り越し
未使用の有給休暇は翌年度に限り繰り越すことができる。繰り越しの上限は20日とする。
## 第4条 特別休暇
夏季特別休暇として毎年3日を付与する。
""",
    "office.md": """# オフィス利用ルール
## ゴミの回収
毎週金曜日の夕方にゴミを回収する。
""",
    "bonus.md": """---
title: 賞与算定基準
category: hr
access: [hr_admin]
---
# 賞与算定基準
## 算定方法
賞与は基本給の2か月分を基準とし、評価に応じて増減する。
""",
}


@pytest.fixture
def docs_dir(tmp_path):
    for name, text in DOCS.items():
        (tmp_path / name).write_text(text, encoding="utf-8")
    return tmp_path


def make_pipeline(docs_dir, jev=None, generator=None, **settings):
    chunks = [c for d in load_documents(docs_dir) for c in chunk_document(d)]
    index = VectorIndex.build(chunks, FakeEmbedder(), {})
    return JevRagPipeline(
        index=index,
        gates=Gates(jev or FakeJev()),
        generator=generator or FakeGenerator(),
        embedder=FakeEmbedder(),
        settings=Settings(**settings),
    )


# ----------------------------------------------------------------------
# Documents / retrieval
# ----------------------------------------------------------------------


def test_front_matter_and_heading_chunks(docs_dir):
    docs = {d.id: d for d in load_documents(docs_dir)}
    assert docs["leave.md"].category == "hr"
    assert docs["bonus.md"].access == ["hr_admin"]
    chunks = chunk_document(docs["leave.md"])
    assert [c.heading for c in chunks] == ["第3条 有給休暇の繰り越し", "第4条 特別休暇"]
    assert chunks[0].display_text.startswith("【休暇規程 > 第3条 有給休暇の繰り越し】")


def test_long_sections_are_split_with_overlap():
    body = "".join(f"これは{i}番目の文です。" for i in range(40))
    doc = Document(id="long.md", title="長い文書", text=f"# 長い文書\n## 節\n{body}")
    chunks = chunk_document(doc, max_chars=100)
    assert len(chunks) > 1
    assert all(len(c.text) <= 120 for c in chunks)
    last_sentence = chunks[0].text.split("。")[-2] + "。"
    assert chunks[1].text.startswith(last_sentence)


def test_access_control_hides_restricted_chunks(docs_dir):
    pipeline = make_pipeline(docs_dir)
    q = "賞与の算定方法は？"
    vec = FakeEmbedder().embed([q], "query")
    public = pipeline.index.search([q], vec, 10)
    admin = pipeline.index.search([q], vec, 10, user_groups=["hr_admin"])
    assert all(c.doc_id != "bonus.md" for c in public)
    assert any(c.doc_id == "bonus.md" for c in admin)


def test_index_roundtrip(docs_dir, tmp_path):
    pipeline = make_pipeline(docs_dir)
    path = tmp_path / "index.json"
    pipeline.index.save(path)
    loaded = VectorIndex.load(path)
    assert [c.id for c in loaded.chunks] == [c.id for c in pipeline.index.chunks]


def test_text_helpers():
    assert split_sentences("上限は20日です[1]。\n- 3日付与されます。［2］") == [
        "上限は20日です。",
        "3日付与されます。",
    ]
    assert split_topics("有給休暇と特別休暇の違いは？") == [
        "有給休暇",
        "特別休暇の違いは？",
    ]


# ----------------------------------------------------------------------
# Pipeline
# ----------------------------------------------------------------------


def test_answers_with_citations_in_three_jev_calls(docs_dir):
    jev = FakeJev()
    answer = make_pipeline(docs_dir, jev=jev).ask(
        "有給休暇の繰り越し上限は何日ですか？"
    )
    assert answer.status == "answered"
    assert "20日" in answer.text
    assert answer.citations[0].heading == "第3条 有給休暇の繰り越し"
    assert all(c.supported for c in answer.claims)
    assert answer.jev_calls == 3


def test_greeting_skips_retrieval_and_llm(docs_dir):
    gen = FakeGenerator()
    answer = make_pipeline(docs_dir, generator=gen).ask("こんにちは")
    assert answer.status == "direct"
    assert answer.jev_calls == 1
    assert gen.calls == 0


def test_vague_query_asks_back(docs_dir):
    assert make_pipeline(docs_dir).ask("それ").status == "clarify"


def test_insufficient_context_does_not_call_llm(docs_dir):
    gen = FakeGenerator()
    answer = make_pipeline(docs_dir, generator=gen).ask("宇宙旅行手当の申請方法は？")
    assert answer.status == "no_answer"
    assert gen.calls == 0
    assert answer.jev_calls == 2


def test_compound_query_searches_each_topic(docs_dir):
    answer = make_pipeline(docs_dir).ask("有給休暇の繰り越しと特別休暇の日数は？")
    assert len(answer.gates["sub_queries"]) == 2
    assert {"leave.md#1", "leave.md#2"} <= set(answer.gates["retrieved"])


def test_unsupported_claims_are_flagged_or_removed(docs_dir):
    text = "繰り越しの上限は20日です。特例で100日まで繰り越せます。"
    flagged = make_pipeline(docs_dir, generator=FakeGenerator(text)).ask(
        "有給休暇の繰り越し上限は？"
    )
    assert [c.supported for c in flagged.claims] == [True, False]
    assert "100日" in flagged.text

    removed = make_pipeline(
        docs_dir, generator=FakeGenerator(text), unsupported_policy="remove"
    ).ask("有給休暇の繰り越し上限は？")
    assert "100日" not in removed.text
    assert "20日" in removed.text


def test_no_information_sentences_are_not_verified(docs_dir):
    text = "繰り越しの上限は20日です[1]。買い取りについては資料に記載がありません。"
    jev = FakeJev()
    answer = make_pipeline(docs_dir, jev=jev, generator=FakeGenerator(text)).ask(
        "有給休暇の繰り越し上限と買い取りは？"
    )
    assert [c.supported for c in answer.claims] == [True, None]
    verify_state = jev.calls[-1][0]
    assert [k for k in verify_state if k.startswith("claim_")] == ["claim_1"]


def test_fail_closed_and_fail_open(docs_dir):
    closed = make_pipeline(docs_dir, jev=FakeJev(fail=True)).ask(
        "有給休暇の繰り越し上限は？"
    )
    assert closed.status == "unavailable"
    assert closed.citations == []

    opened = make_pipeline(docs_dir, jev=FakeJev(fail=True), fail_mode="open").ask(
        "有給休暇の繰り越し上限は？"
    )
    assert opened.status == "answered"
    assert all(c.supported is None for c in opened.claims)


def test_routing_filters_by_category_when_enabled(docs_dir):
    pipeline = make_pipeline(docs_dir, use_routing=True)
    pipeline.gates.routes = {"hr": "人事", "general": "その他"}
    answer = pipeline.ask("ゴミの回収日は？")
    assert all(not r.startswith("office.md") for r in answer.gates["retrieved"])


def test_audit_log(docs_dir, tmp_path):
    log = tmp_path / "audit.jsonl"
    make_pipeline(docs_dir, audit_log_path=str(log), audit_log_query_text=False).ask(
        "有給休暇の繰り越し上限は？"
    )
    record = json.loads(log.read_text(encoding="utf-8").splitlines()[0])
    assert record["query"] is None
    assert record["status"] == "answered"
    assert record["jev_calls"] == 3


def test_settings_from_env(monkeypatch):
    monkeypatch.setenv("JEV_RAG_SUFFICIENCY_THRESHOLD", "0.8")
    monkeypatch.setenv("JEV_RAG_USE_ROUTING", "true")
    monkeypatch.setenv("JEV_RAG_TOP_K", "7")
    s = Settings.from_env()
    assert (s.sufficiency_threshold, s.use_routing, s.top_k) == (0.8, True, 7)


def test_http_api(docs_dir):
    from fastapi.testclient import TestClient
    from jev_rag.server import create_app

    client = TestClient(create_app(make_pipeline(docs_dir)))
    body = client.post("/ask", json={"query": "有給休暇の繰り越し上限は？"}).json()
    assert body["status"] == "answered"
    assert body["citations"][0]["doc_id"] == "leave.md"
    assert client.get("/healthz").json()["ok"] is True


def test_typesafe_backend_builds_sdk_questions():
    pytest.importorskip("typesafe_sdk")
    from jev_rag.gates import TypeSafeBackend
    from typesafe_sdk import Choice, Noul, Score

    class FakeAnswer:
        def __init__(self, data):
            self.data = data

        def model_dump(self, exclude=None):
            return dict(self.data)

    class FakeClient:
        def system_one(self, state, questions):
            self.questions = questions
            return SimpleNamespace(
                model="jev-test",
                usage=None,
                answers={"q": FakeAnswer({"type": "noul", "noul": 0.7})},
            )

    client = FakeClient()
    backend = TypeSafeBackend("jev-test", client=client)
    out = backend.ask(
        {"query": "x"},
        {
            "c": {"type": "choice", "instructions": "i", "criteria": {"a": "A"}},
            "s": {"type": "score", "instructions": "i", "criteria": ["0: x", "1: y"]},
            "q": {"type": "noul", "instructions": "i"},
        },
    )
    assert isinstance(client.questions["c"], Choice)
    assert isinstance(client.questions["s"], Score)
    assert isinstance(client.questions["q"], Noul)
    assert out == {
        "answers": {"q": {"type": "noul", "noul": 0.7}},
        "model": "jev-test",
        "usage": {},
    }


def test_low_confidence_vague_verdict_searches_anyway(docs_dir):
    class UnsureJev(FakeJev):
        def ask(self, state, questions):
            resp = super().ask(state, questions)
            if "intent" in resp["answers"]:
                resp["answers"]["intent"] = {
                    "choice": "clarification_needed",
                    "confidence": 0.27,
                }
            return resp

    answer = make_pipeline(docs_dir, jev=UnsureJev()).ask("有給休暇の繰り越し上限は？")
    assert answer.status == "answered"
    assert answer.gates["intent_overridden"] == "clarification_needed"


def test_confident_vague_verdict_still_asks_back(docs_dir):
    class SureJev(FakeJev):
        def ask(self, state, questions):
            resp = super().ask(state, questions)
            if "intent" in resp["answers"]:
                resp["answers"]["intent"] = {
                    "choice": "clarification_needed",
                    "confidence": 0.99,
                }
            return resp

    assert make_pipeline(docs_dir, jev=SureJev()).ask("それ").status == "clarify"
