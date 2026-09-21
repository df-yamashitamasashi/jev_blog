"""
UseCase 1: サポートチケットの自動マルチトリアージと動的エスカレーション
"""

from dataclasses import dataclass

from typesafe_sdk import (
    Choice,
    ChoiceAnswer,
    Noul,
    NoulAnswer,
    Score,
    ScoreAnswer,
    TypeSafeClient,
)


@dataclass
class TriageResult:
    ticket_id: str
    department: str
    urgency_probability: float
    frustration_level: float
    auto_routed: bool
    review_reason: str | None = None


def triage_customer_ticket(
    ticket_id: str,
    message: str,
    client: TypeSafeClient | None = None,
) -> TriageResult:
    if client is None:
        client = TypeSafeClient()

    # 1回のリクエストで多角的な判断を並行取得 (Speculative Fan-out)
    response = client.system_one(
        state={"ticket_id": ticket_id, "body": message},
        questions={
            "department": Choice(
                instructions="`body` の内容を解決するのに最適な部署を選択してください",
                criteria={
                    "billing": "請求、決済、二重引き落とし、プラン変更、解約に関する問題",
                    "technical": "システム障害、ログイン不能、バグ、API連携エラー",
                    "sales": "新規導入相談、大規模契約、見積もり依頼",
                    "general": "上記のどれにも明確に当てはまらない一般的な問い合わせ",
                },
            ),
            "frustration": Score(
                instructions="顧客が感じている不満や怒りの度合いを測定してください",
                criteria=[
                    "0: 冷静、事実のみを記載",
                    "1: 軽度の不満、困惑",
                    "2: 強い怒り、抗議、業務への支障を訴えている",
                ],
            ),
            "is_urgent": Noul(
                instructions="`body` は即座の対応が必要な緊急事態を示唆していますか？",
            ),
        },
    )

    dept_answer = response.answers["department"]
    frustration_answer = response.answers["frustration"]
    urgent_answer = response.answers["is_urgent"]

    assert isinstance(dept_answer, ChoiceAnswer)
    assert isinstance(frustration_answer, ScoreAnswer)
    assert isinstance(urgent_answer, NoulAnswer)

    frustration_score = frustration_answer.score
    is_urgent_prob = urgent_answer.noul

    # --- ソフトウェアによる決定論的ルーティング制御 ---
    # ルール1: 確信度が0.75未満なら、誤配備を防ぐため人手確認へ
    if dept_answer.confidence < 0.75:
        return TriageResult(
            ticket_id=ticket_id,
            department="human_triage_queue",
            urgency_probability=is_urgent_prob,
            frustration_level=frustration_score,
            auto_routed=False,
            review_reason=f"低確信度 ({dept_answer.confidence:.2f}) のため手動振り分け",
        )

    # ルール2: 怒りレベルが極めて高い（> 1.6）または緊急度が極めて高い場合はVIP即時対応
    assigned_dept = dept_answer.choice
    if frustration_score >= 1.6 or is_urgent_prob >= 0.85:
        assigned_dept = f"{assigned_dept}_urgent_escalation"

    return TriageResult(
        ticket_id=ticket_id,
        department=assigned_dept,
        urgency_probability=is_urgent_prob,
        frustration_level=frustration_score,
        auto_routed=True,
    )


if __name__ == "__main__":
    sample_message = (
        "本番環境の決済Webhookが今朝から全て500エラーで落ちています！"
        "すでに数百万円の売上機会を損失しており、クライアントからもクレームが殺到しています。"
        "今すぐエンジニアから連絡をください！"
    )

    result = triage_customer_ticket("TICKET-1092", sample_message)
    print(f"[トリアージ結果] Ticket: {result.ticket_id}")
    print(f"  割り当て先: {result.department}")
    print(f"  怒りレベル: {result.frustration_level:.2f} / 2.0")
    print(f"  緊急度確率: {result.urgency_probability * 100:.1f}%")
    print(f"  自動配備: {result.auto_routed}")
