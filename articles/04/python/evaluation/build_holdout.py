"""Unseen questions for checking the post-evaluation improvements (v2).

Written before running v2, and never used for tuning. Run to regenerate holdout.jsonl.
The improvements target (a) real questions misread as "vague" and (b) Gate 5 false
alarms, so the set mixes terse questions with greetings / vague inputs that must keep
their current behaviour.
"""

import json
from pathlib import Path

ROWS = [
    # id, type, query, route, evidence, answer_keywords
    (
        "h01",
        "answerable",
        "インボイス番号",
        "faq",
        [["T1234567890123"]],
        [["T1234567890123"]],
    ),
    (
        "h02",
        "answerable",
        "通勤手当の上限",
        "hr",
        [["月50,000円を上限"]],
        [["50,000円", "5万円", "50000円"]],
    ),
    (
        "h03",
        "answerable",
        "APIキーを止めずに切り替える方法を教えて",
        "api",
        [["古いキーを無効化"]],
        [["新しいキー"], ["無効"]],
    ),
    (
        "h04",
        "answerable",
        "有休の繰り越し",
        "hr",
        [["繰り越せる日数の上限は20日"]],
        [["翌年度"]],
    ),
    ("h05", "answerable", "Webhookの署名方式", "api", [["HMAC-SHA256"]], [["HMAC"]]),
    ("h06", "unanswerable", "駐車場", "general", [], []),
    ("h07", "unanswerable", "副業の申請方法", "hr", [], []),
    ("h08", "chitchat", "ありがとうございました！", None, [], []),
    ("h09", "vague", "これってどう？", None, [], []),
    ("h10", "vague", "例のやつ、教えて", None, [], []),
]
INTENT = {"chitchat": "direct_answer", "vague": "clarification_needed"}

if __name__ == "__main__":
    out = Path(__file__).with_name("holdout.jsonl")
    with out.open("w", encoding="utf-8") as f:
        for id_, type_, query, route, evidence, keywords in ROWS:
            row = {
                "id": id_,
                "split": "holdout",
                "type": type_,
                "query": query,
                "expected_intent": INTENT.get(type_, "knowledge_search"),
                "expected_route": route,
                "expected_decompose": False,
                "answerable": type_ == "answerable",
                "evidence": evidence,
                "answer_keywords": keywords,
            }
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(f"wrote {len(ROWS)} rows -> {out}")
