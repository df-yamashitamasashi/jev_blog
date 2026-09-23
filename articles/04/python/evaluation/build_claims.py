"""Gate 5 test sentences: for each source chunk, 2 supported and 2 unsupported claims.

Unsupported claims are either a changed number ("num") or an added condition that
the source does not state ("add"). Run to regenerate claims.jsonl.
"""

import json
from pathlib import Path

# (split, source evidence substring, [(claim, label, kind), ...])
SOURCES = [
    (
        "dev",
        "繰り越せる日数の上限は20日",
        [
            (
                "翌年度に限り、使い切れなかった年次有給休暇を繰り越せる。",
                True,
                "paraphrase",
            ),
            (
                "繰り越し分を含めて保有できる有給休暇は最大40日である。",
                True,
                "paraphrase",
            ),
            ("繰り越せる日数の上限は30日である。", False, "num"),
            ("繰り越した有給休暇は、翌々年度まで使用できる。", False, "add"),
        ],
    ),
    (
        "test",
        "在宅勤務手当5,000円",
        [
            (
                "在宅勤務を月4日以上行った月に在宅勤務手当が支給される。",
                True,
                "paraphrase",
            ),
            ("在宅勤務手当は5,000円で、給与に加算される。", True, "paraphrase"),
            ("在宅勤務手当は月10,000円である。", False, "num"),
            ("在宅勤務手当は、在宅勤務を1日でも行えば支給される。", False, "add"),
        ],
    ),
    (
        "test",
        "東京23区・大阪市・名古屋市が12,000円",
        [
            ("東京23区での宿泊費の上限は1泊12,000円である。", True, "paraphrase"),
            (
                "東京23区・大阪市・名古屋市以外の地域では、宿泊費の上限は1泊10,000円である。",
                True,
                "paraphrase",
            ),
            ("大阪市での宿泊費の上限は1泊15,000円である。", False, "num"),
            ("宿泊費の上限を超えた分は、部長の承認があれば支給される。", False, "add"),
        ],
    ),
    (
        "test",
        "1人あたり5,000円まで",
        [
            ("取引先との会食費は1人あたり5,000円までである。", True, "paraphrase"),
            (
                "会食費が1人5,000円を超える場合は、事前に部長の承認が必要である。",
                True,
                "paraphrase",
            ),
            ("会食費の上限は1人あたり10,000円である。", False, "num"),
            (
                "会食費が上限を超える場合は、事後に所属長へ報告すればよい。",
                False,
                "add",
            ),
        ],
    ),
    (
        "test",
        "12文字以上",
        [
            ("パスワードは12文字以上にする必要がある。", True, "paraphrase"),
            (
                "社内システムへのログインには多要素認証が必須である。",
                True,
                "paraphrase",
            ),
            ("パスワードは8文字以上であればよい。", False, "num"),
            ("パスワードは90日ごとに変更しなければならない。", False, "add"),
        ],
    ),
    (
        "test",
        "「社外秘」までの情報を入力してよい",
        [
            (
                "会社が法人契約した生成AIには、社外秘の情報まで入力してよい。",
                True,
                "paraphrase",
            ),
            ("顧客の個人情報は生成AIに入力してはならない。", True, "paraphrase"),
            ("極秘情報も、法人契約した生成AIであれば入力してよい。", False, "add"),
            ("個人で契約した生成AIにも、社外秘の情報を入力してよい。", False, "add"),
        ],
    ),
    (
        "test",
        "Standardプランが600回",
        [
            (
                "Standardプランでは1分あたり600回までリクエストできる。",
                True,
                "paraphrase",
            ),
            ("Enterpriseプランの上限は1分あたり6,000回である。", True, "paraphrase"),
            ("Freeプランの上限は1分あたり100回である。", False, "num"),
            ("Proプランでは1分あたり3,000回までリクエストできる。", False, "add"),
        ],
    ),
    (
        "test",
        "最大5回",
        [
            (
                "受信側は10秒以内に2xxのステータスコードを返す必要がある。",
                True,
                "paraphrase",
            ),
            ("失敗した Webhook は最大5回まで再送される。", True, "paraphrase"),
            ("失敗した Webhook は最大10回まで再送される。", False, "num"),
            ("再送は常に1分間隔で行われる。", False, "add"),
        ],
    ),
    (
        "test",
        "残りの期間分の返金は行っていません",
        [
            (
                "年払いプランを途中で解約しても、残りの期間分は返金されない。",
                True,
                "paraphrase",
            ),
            (
                "解約後も契約期間の終了日まではすべての機能を利用できる。",
                True,
                "paraphrase",
            ),
            (
                "年払いプランを途中で解約すると、残りの期間分が日割りで返金される。",
                False,
                "add",
            ),
            ("解約すると、その日のうちに機能が使えなくなる。", False, "add"),
        ],
    ),
    (
        "test",
        "通算93日まで",
        [
            ("介護休業は対象家族1人につき通算93日まで取得できる。", True, "paraphrase"),
            ("介護休業は3回まで分割して取得できる。", True, "paraphrase"),
            ("介護休業は対象家族1人につき通算180日まで取得できる。", False, "num"),
            ("介護休業を取得すると、会社から給与の67%が支給される。", False, "add"),
        ],
    ),
    (
        "test",
        "7日間保存しています",
        [
            ("データは毎日バックアップされる。", True, "paraphrase"),
            ("バックアップは7日間保存される。", True, "paraphrase"),
            ("バックアップは30日間保存される。", False, "num"),
            ("バックアップからの復元は無料で何度でも依頼できる。", False, "add"),
        ],
    ),
]

if __name__ == "__main__":
    out = Path(__file__).with_name("claims.jsonl")
    n = 0
    with out.open("w", encoding="utf-8") as f:
        for i, (split, evidence, claims) in enumerate(SOURCES, 1):
            for j, (claim, label, kind) in enumerate(claims, 1):
                n += 1
                row = {
                    "id": f"s{i:02d}c{j}",
                    "split": split,
                    "source_evidence": evidence,
                    "claim": claim,
                    "supported": label,
                    "kind": kind,
                }
                f.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(f"wrote {n} claims -> {out}")
