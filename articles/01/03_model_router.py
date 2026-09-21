"""
UseCase 3: コスト＆レイテンシを最適化するインテリジェント・モデルルーター
"""

from typing import Literal

from typesafe_sdk import (
    Choice,
    ChoiceAnswer,
    Score,
    ScoreAnswer,
    TypeSafeClient,
)

ModelTier = Literal["fast_cheap", "balanced", "deep_reasoning"]


def route_llm_model(user_query: str, client: TypeSafeClient | None = None) -> dict:
    if client is None:
        client = TypeSafeClient()

    response = client.system_one(
        state=user_query,
        questions={
            "task_type": Choice(
                instructions="このクエリが求めている主たるタスクの種類を選択してください",
                criteria={
                    "simple_qa": "一般的な事実確認、単語の意味、簡単な挨拶や要約",
                    "creative_writing": "メールの下書き、キャッチコピー、文章の推敲",
                    "coding": "プログラムコードの作成、デバッグ、リファクタリング",
                    "complex_reasoning": "論理パズル、数学、アルゴリズム設計、アーキテクチャ設計",
                },
            ),
            "complexity": Score(
                instructions="このタスクを正確に解決するために必要な論理的思考の深さ・難易度",
                criteria=[
                    "0: 初歩的、定型的な知識だけで即答可能",
                    "1: 中程度、文脈の理解や複数ステップの処理が必要",
                    "2: 極めて高度、深い専門知識、抽象思考、高度な推論が不可欠",
                ],
            ),
        },
    )

    task_ans = response.answers["task_type"]
    complexity_ans = response.answers["complexity"]

    assert isinstance(task_ans, ChoiceAnswer)
    assert isinstance(complexity_ans, ScoreAnswer)

    task = task_ans.choice
    complexity = complexity_ans.score

    # ルーティング戦略の決定
    if complexity >= 1.5 or task == "complex_reasoning":
        selected_model = "deep_reasoning"  # 例: Claude 3.7 Sonnet (Thinking) や o3-mini
        reason = f"高難易度タスク ({task}, complexity: {complexity:.2f}) のため推論モデルを選定"
    elif complexity >= 0.7 or task in ["coding", "creative_writing"]:
        selected_model = "balanced"  # 例: Claude 3.5 Sonnet や GPT-4o
        reason = f"標準的タスク ({task}, complexity: {complexity:.2f}) のためバランスモデルを選定"
    else:
        selected_model = "fast_cheap"  # 例: Claude 3.5 Haiku や GPT-4o-mini
        reason = f"平易なクエリ ({task}, complexity: {complexity:.2f}) のため高速安価モデルを選定"

    return {
        "selected_model": selected_model,
        "task": task,
        "complexity": complexity,
        "reason": reason,
    }


if __name__ == "__main__":
    queries = [
        "TypeScriptで引数に渡したオブジェクトの特定のキーを除外するOmitユーティリティ型の自作方法を解説して",
        "オーストラリアの首都はどこですか？",
        "分散トランザクションにおいて2相コミット(2PC)がブロッキングプロトコルと呼ばれる理由とSagaパターンとの比較",
    ]

    for q in queries:
        routing = route_llm_model(q)
        print(f"\nQ: {q[:40]}...")
        print(f" ▶ 採用モデル: {routing['selected_model']} ({routing['reason']})")
