"""
Unit tests for Jev Adaptive RAG Pipeline (Python)
"""

import pytest
from rag_pipeline import JevAdaptiveRagPipeline, StandaloneSimulatorClient


@pytest.fixture
def pipeline():
    return JevAdaptiveRagPipeline(client=StandaloneSimulatorClient())


def test_triage_direct_answer(pipeline):
    res = pipeline.run("こんにちは！")
    assert res.is_direct_answer is True
    assert res.is_fallback is False
    assert res.llm_called is False
    assert res.attribution_score is None
    assert len(res.accepted_passages) == 0


def test_triage_clarification(pipeline):
    res = pipeline.run("それ")
    assert res.is_clarification_needed is True
    assert res.llm_called is False


def test_full_rag_pipeline_execution(pipeline):
    res = pipeline.run("有給休暇の繰り越し上限は何日ですか？")
    assert res.is_direct_answer is False
    assert res.is_fallback is False
    assert res.llm_called is True
    assert len(res.accepted_passages) >= 1
    assert res.attribution_score == 100
    assert "20日" in res.final_answer


def test_answer_depends_on_retrieved_context(pipeline):
    res = pipeline.run("入社半年後に付与される有給休暇は何日ですか？")
    assert res.is_fallback is False
    assert "10日" in res.final_answer


def test_decomposition_searches_each_topic(pipeline):
    res = pipeline.run("有給休暇と特別休暇の違いは？")
    assert len(res.sub_queries) > 1
    assert "特別休暇" in res.final_answer
    assert "有給休暇" in res.final_answer


def test_fallback_on_unanswerable_query(pipeline):
    res = pipeline.run("社内の宇宙旅行手当について教えてください")
    assert res.is_fallback is True
    assert res.llm_called is False
    assert res.attribution_score is None
    assert "該当する客観的な根拠や情報は見当たりませんでした" in res.final_answer
    assert len(res.verified_claims) == 0


def test_gate5_flags_fabricated_claims():
    def hallucinating_llm(query: str, context: str) -> str:
        return "未使用の有給休暇は翌年度に限り繰り越しが認められます。特例として最大100日まで繰り越せます。"

    pipeline = JevAdaptiveRagPipeline(
        client=StandaloneSimulatorClient(), generator=hallucinating_llm
    )
    res = pipeline.run("有給休暇の繰り越し上限は何日ですか？")
    assert [c.is_supported for c in res.verified_claims] == [True, False]
    assert res.attribution_score == 50
