"""
Unit tests for Jev Adaptive RAG Pipeline (Python)
"""

import pytest
from rag_pipeline import JevAdaptiveRagPipeline


@pytest.fixture
def pipeline():
    return JevAdaptiveRagPipeline()


def test_triage_direct_answer(pipeline):
    res = pipeline.run("こんにちは！")
    assert res.is_direct_answer is True
    assert res.is_fallback is False
    assert res.tokens_saved_percent == 100
    assert len(res.accepted_passages) == 0


def test_triage_clarification(pipeline):
    res = pipeline.run("それ")
    assert res.is_clarification_needed is True
    assert res.tokens_saved_percent == 100


def test_full_rag_pipeline_execution(pipeline):
    res = pipeline.run("有給休暇の繰り越し上限は何日ですか？")
    assert res.is_direct_answer is False
    assert res.is_fallback is False
    assert len(res.accepted_passages) >= 1
    assert res.attribution_score >= 80
    assert "20日" in res.final_answer


def test_fallback_on_unanswerable_query(pipeline):
    res = pipeline.run("社内の宇宙旅行手当について教えてください")
    assert res.is_fallback is True
    assert "該当する客観的な根拠や情報は見当たりませんでした" in res.final_answer
    assert len(res.verified_claims) == 0
