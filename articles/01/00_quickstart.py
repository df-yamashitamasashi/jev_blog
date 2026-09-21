"""
Jev Quickstart (Hello World)
"""

from typesafe_sdk import Noul, NoulAnswer, TypeSafeClient


def main():
    # 環境変数 TYPESAFE_API_KEY から自動読み込み
    client = TypeSafeClient()

    # 評価対象のコンテキスト（State）
    state = "3日前に解約リクエストを送ったのですが、まだ請求が届いています。早急に返金してください。"

    # 質問の定義と実行
    response = client.system_one(
        state=state,
        questions={
            "is_refund_request": Noul(
                instructions="このメッセージは返金を要求していますか？"
            ),
        },
    )

    # 厳密に型付けされた結果を取得
    ans = response.answers["is_refund_request"]
    assert isinstance(ans, NoulAnswer)
    print(f"返金要求確率: {ans.noul}")


if __name__ == "__main__":
    main()
