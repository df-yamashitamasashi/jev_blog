"""
UseCase 4: RAGにおけるパッセージ・リランキングと引用のハルシネーション検証
"""

from dataclasses import dataclass

from typesafe_sdk import (
    Noul,
    NoulAnswer,
    Score,
    ScoreAnswer,
    TypeSafeClient,
)


@dataclass
class Passage:
    id: str
    text: str
    relevance_score: float = 0.0


def rerank_passages(
    query: str, candidates: list[Passage], client: TypeSafeClient | None = None
) -> list[Passage]:
    """検索候補の各パッセージをJevで評価し、真に関連性の高い順にソート"""
    if client is None:
        client = TypeSafeClient()

    reranked = []
    for passage in candidates:
        response = client.system_one(
            state={"query": query, "passage": passage.text},
            questions={
                "relevance": Score(
                    instructions="`passage` の内容は `query` の回答としてどれくらい有用・関連していますか？",
                    criteria=[
                        "0: 無関係、トピックが異なる",
                        "1: 部分的に関連、背景知識や周辺情報に留まる",
                        "2: 非常に有用、質問への直接的な回答や根拠が含まれている",
                    ],
                )
            },
        )
        rel_ans = response.answers["relevance"]
        assert isinstance(rel_ans, ScoreAnswer)
        score = rel_ans.score
        reranked.append(
            Passage(id=passage.id, text=passage.text, relevance_score=score)
        )

    return sorted(reranked, key=lambda p: p.relevance_score, reverse=True)


def verify_citation_faithfulness(
    claim: str, source_text: str, client: TypeSafeClient | None = None
) -> bool:
    """LLMが生成した主張が、引用元の原文によって客観的に裏付けられているかを検証"""
    if client is None:
        client = TypeSafeClient()

    response = client.system_one(
        state={"claim": claim, "source": source_text},
        questions={
            "is_supported": Noul(
                instructions=(
                    "`claim` に書かれた主張や数値は、`source` の文脈によって"
                    "論理的・事実として完全に裏付けられていますか？"
                )
            )
        },
    )

    supported_ans = response.answers["is_supported"]
    assert isinstance(supported_ans, NoulAnswer)

    # 支持確率が85%以上なら合格、それ未満ならハルシネーション警告
    return supported_ans.noul >= 0.85


if __name__ == "__main__":
    user_query = "当社の年間有給休暇の繰り越し上限日数は何日ですか？"
    candidates = [
        Passage(
            id="P1",
            text="有給休暇は入社半年後に10日付与されます。勤続年数に応じて最大20日となります。",
        ),
        Passage(
            id="P2",
            text="未使用の有休は翌年度に限り繰り越しが可能です。ただし繰り越し可能な日数は最大20日を限度とします。",
        ),
        Passage(
            id="P3", text="特別休暇として慶弔休暇および夏季休暇が3日付与されます。"
        ),
    ]

    print("--- 1. リランキング実行 ---")
    ranked = rerank_passages(user_query, candidates)
    for p in ranked:
        print(f"[{p.id}] スコア: {p.relevance_score:.2f} | 本文: {p.text[:30]}...")

    print("\n--- 2. LLM生成回答の引用検証 ---")
    generated_claim = "年間で繰り越せる有給休暇の上限は最大20日間です。"
    is_valid = verify_citation_faithfulness(generated_claim, ranked[0].text)
    print(f"主張: 「{generated_claim}」")
    print(f"検証結果: {'✅ 正当な引用' if is_valid else '❌ ハルシネーションの疑い'}")
