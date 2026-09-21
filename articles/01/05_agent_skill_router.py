"""
UseCase 5: 大規模ツール群から最適なツールを即時選定するエージェント・スキルルーター
"""

from typesafe_sdk import (
    Choice,
    ChoiceAnswer,
    Noul,
    NoulAnswer,
    TypeSafeClient,
)


def route_agent_tools(
    user_prompt: str,
    available_tools: dict[str, str],
    client: TypeSafeClient | None = None,
) -> list[str] | None:
    if client is None:
        client = TypeSafeClient()

    # 1. そもそも外部ツールの呼び出しが必要かをYes/No判定
    # 2. どのツールカテゴリが最も合致するかを選択
    response = client.system_one(
        state=user_prompt,
        questions={
            "needs_tool": Noul(
                instructions="このユーザーリクエストを満たすには、外部ツールの実行やデータ取得が必要ですか？"
            ),
            "selected_tool": Choice(
                instructions="このリクエストの処理に最も適したツールを選択してください",
                criteria=available_tools,
            ),
        },
    )

    needs_ans = response.answers["needs_tool"]
    tool_ans = response.answers["selected_tool"]

    assert isinstance(needs_ans, NoulAnswer)
    assert isinstance(tool_ans, ChoiceAnswer)

    needs_tool = needs_ans.noul >= 0.70
    if not needs_tool:
        return None  # 通常のテキスト会話で回答可能

    # 確率上位のツールを抽出（例: 確率15%以上のものを候補としてLLMに渡す）
    selected_tools: list[str] = [
        str(tool_name)
        for tool_name, prob in tool_ans.probabilities.items()
        if prob >= 0.15
    ]

    return selected_tools


if __name__ == "__main__":
    tools_catalog = {
        "weather_api": "指定した都市の現在の天気、気温、降水確率を取得する",
        "github_pr_search": "GitHubリポジトリのオープンなプルリクエストやコミットログを検索する",
        "database_query": "顧客DBや売上テーブルからSQLを使ってデータを集計・取得する",
        "calendar_schedule": "Googleカレンダーの空きスロット検索や予定の作成を行う",
        "calculator": "複雑な複利計算や統計的な数式計算を実行する",
    }

    user_input = (
        "明日の14時から田中さんとの打ち合わせを入れたいんだけど、空いてるかな？"
    )
    tools_to_inject = route_agent_tools(user_input, tools_catalog)

    print(f"ユーザー入力: 「{user_input}」")
    if tools_to_inject:
        print(f"🎯 LLMに注入するツール定義: {tools_to_inject}")
    else:
        print("💬 ツール呼び出し不要（チャットモデルで直接返答）")
