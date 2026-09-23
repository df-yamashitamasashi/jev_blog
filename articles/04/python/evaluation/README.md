# 評価プロトコル（Jev Adaptive RAG）

本物の Jev（TypeSafe API）と Gemini を使って、パイプラインの実力を測るための手順と判定基準です。
**この文書は本番評価（test）の実行前に確定させたもの**で、以降は評価対象のコード・データ・しきい値を変更しません。

## 1. 評価データ

| ファイル | 内容 |
| :--- | :--- |
| `../sample_docs/` | 架空の会社「サンプルテック」の社内文書 20 件（人事・経費・セキュリティ・API仕様・顧客FAQ・オフィス）。うち1件は人事部限定（`access: [hr_admin]`） |
| `dataset.jsonl` | 質問 68 件（`build_dataset.py` から生成）。調整用 `dev` 8 件、本番評価用 `test` 60 件 |
| `claims.jsonl` | Gate 5 用の文 44 件（`build_claims.py` から生成）。根拠あり 22 件、根拠なし 22 件（数値の改変・条件の付け足し） |

test 60 件の内訳: 答えのある質問 28 / 複合質問 6 / 答えのない質問 18（うち大半は「惜しいが文書にない」質問）/ 閲覧権限のない文書にしか答えがない質問 2 / 挨拶 3 / 曖昧な入力 3

## 2. 手順

1. `dev` で動作確認と調整を行う（何度実行してもよい）。
2. このプロトコルを確定する（下記ハッシュ値を記録）。
3. `test` を **1回だけ** 実行する。途中で止まった場合は同じコマンドで再開する（保存済みの応答を使うため API は呼び直さない）。
4. `python -m evaluation.analyze --split test` で集計する（API は使わない）。

```bash
cd articles/04/python
python -m evaluation.run_eval --split test
python -m evaluation.analyze --split test
python -m evaluation.analyze --split test --failures   # 目視確認用
```

## 3. 構成（固定）

| 項目 | 値 |
| :--- | :--- |
| Jev モデル | `jev-1.13.0` |
| 回答生成 | `gemini-3.8-flash`（temperature 0, seed 0, thinking_level low） |
| Embedding | `gemini-embedding-2`（768次元） |
| 検索 | BM25（文字バイグラム）＋ベクトル検索の RRF、上位5件、ルーティングによる絞り込みなし |
| しきい値 | Gate 3: 1.0 / Gate 4: 0.70 / Gate 5: 0.85 / Gate 2: 0.75 |
| 利用者の権限 | 一般社員（`user_groups=None`） |

**比較対象（ベースライン）**: 同じ検索・同じ Gemini・同じプロンプトで、ゲートを一切通さずに全質問へ回答させる。

## 4. 判定基準（事前登録）

| 指標 | 合格ライン |
| :--- | :--- |
| 答えのない質問（18件＋権限なし2件）を LLM に渡さず止めた割合 | 90% 以上 |
| 答えのある質問（34件）を誤って止めた割合 | 15% 以下 |
| Gate 5: 根拠のない文（20件）を検出した割合 | 90% 以上 |
| Gate 5: 根拠のある文（20件）を誤って疑った割合 | 10% 以下 |

基準に届かなかった場合も、結果をそのまま報告する。

補足: 件数が少ないため、各割合には 95% 信頼区間（Wilson）を併記する。答えの正誤はキーワード一致で自動判定し、不一致・誤検知はすべて目視で確認する。

## 5. dev での調整内容（test 実行前）

- `gemini-embedding-2` は文字列のリストを1つのベクトルにまとめてしまうため、1件ずつ `Content` として送るよう修正した。
- ベースライン回答の Gate 5 検証から「資料に記載がありません」の文を除外した（事実の主張ではないため）。
- 本番と同じく、トリアージにルーティングの質問を含めた（検索の絞り込みには使わない）。
- ゲートの質問文・しきい値は dev の結果を見て変更していない。

## 6. 確定時のファイルハッシュ（SHA-256）

確定日時: 2026-09-23T08:01Z

```
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  evaluation/__init__.py
eb23fbec8320d5440219f201c0b4ea2b6bb0c2385bcb82a87616504ed66fa903  evaluation/analyze.py
18c31ee16dcd9c44352ef859e50621af55b470a86dfe3d8c1b422c69bbee239d  evaluation/build_claims.py
98317d4614bb230929e89612092c5377836dde4959fe4e00e1e1dc9cc8dc75da  evaluation/build_dataset.py
e73a1703a53680ca67ab6580a22970412d081c237628c3c6b2775ec3f4b0e153  evaluation/cache.py
ebd5a5dadd181624e0125ad5b729452ab82b0d43f077c2b1b5ad8565a0f4223d  evaluation/claims.jsonl
fb474777a3dc44fa0fd4a73e33392fd18ff541dc5847c8c4f1d1e3e29b496f93  evaluation/dataset.jsonl
308ffe1a6cca567a3702169aedf6f18fdd6246dbce93a16fd7547c525d15578a  evaluation/run_eval.py
28355aaff9991496cb9d4d16b5694e0c87be89761a3bcec0b1147f7014911f6e  jev_rag/__init__.py
80dd074d63d40339af8e5188e9d15141e0a38b385755eddf868eb7b7ff61c1ce  jev_rag/__main__.py
0358931830ec17b5fc4a10093079b215d7bae962d5c4da583a463713ea57f3c3  jev_rag/app.py
cc325380117bed02622e75fe0e4621355b60ce9cac655b483f010914f1b38ff1  jev_rag/config.py
a206a9e4915beab662d2e34a06b22fe80a2ec70efcb1ea2fcdeb0e389c16c55f  jev_rag/documents.py
06d31889695b1b38e87e9a0d50a3ac21345ffe0f0fbef8e33d57c27b2adf476c  jev_rag/gates.py
d0b276deaa399e829948b7c3cf013c6dfe4a530c75a956fedf2e3b6d8bca9744  jev_rag/gemini.py
6991cb4774d9f7499a239a7b09597f688cfde5344e1ec13e4113e72ca2a95e6c  jev_rag/pipeline.py
6b547b67e4d2c21ebc75341c319ee68346d7315962159dc74af7f5f1205123db  jev_rag/retrieval.py
d80bce7dc1e9ad6b214ef61361c460156c62149e8687f6eaad826d371af0a2fd  jev_rag/server.py
ad7cde2f5afae7f265aa81cf5b745fd8c16034abae36d9963d5b7453138eeb13  jev_rag/text.py
ae5eee6b88f0b957e831b32a661e3d054f634938000265e978747e6f8b92ac63  sample_docs/api/auth.md
8ba454e89e59d58e9730ed49fe391e1539b197e0b696b3ae832ca4c6af945314  sample_docs/api/errors.md
b72764c5621edc42984714f8dd11cfabe4980ff2553d0c7b87f60dd016ecf76f  sample_docs/api/rate_limit.md
2f0ab6f10489317adc1a67d45de684c729d67df8a1c2c8dd25964e6345ff79d0  sample_docs/api/webhooks.md
5f259a59206e457c73af761955bec11efc9429a8352449c6375156459760f0a4  sample_docs/categories.json
410b667946b7f1607e809df025b8f7f16cff367aa3d18bce4d792e075ca2de8b  sample_docs/expense/domestic_travel.md
1368d7ab0753293476014ca3bff0f0cafb8a9e00e912677f255b20480d117e5e  sample_docs/expense/expense.md
ae9c3d546ccf49e65df00e6839656753eb62aee491702774482789bf6848c3fc  sample_docs/faq/billing.md
cec3ef1e298256b914b6060bb5679f10cdfd6616e5db9a588412578b6577818f  sample_docs/faq/contract.md
8961846165e624cb26b15cade423d1d88cb68d780acc0c50a3cac9120f380e7b  sample_docs/faq/data.md
53eece21d38f066e66975baf6e807b955ac7772addc9babc1bedcfec797cf539  sample_docs/general/office.md
f22330b1929656cf8820eeac2bcaa881d643f232ca8ef29afb2ec20feae353d7  sample_docs/hr/allowances.md
97976cd9804b3a8bd74b0bed4582c83be08c54047e91bc4e35c788776a0d5b9f  sample_docs/hr/bonus_criteria.md
2d478929106fb2b519b18ba8f8629c4870c60fb7cf4268a7457923b3c3c1284a  sample_docs/hr/childcare.md
f3058686ebf47056b8abf2f4821273d84d2fa29603472c905ab1a44201b7d6ae  sample_docs/hr/leave.md
36365ebca367cd8dfe6af9c5599cc6f0925d0b0b9070d00097b2f3846365a0f9  sample_docs/hr/remote_work.md
e95055c7b740c8b97d463d72ca4adab2d34e058fd8677c660ab2db9b2e664005  sample_docs/hr/training.md
407fa217055e16daacd4994fbf534c1a4ced763f0dad8454be043a6e4bf4229e  sample_docs/hr/working_hours.md
568bc1bbca9c5c5c759d7c46b40aa5c1fa57c53348c66b698f1fed8992de2d23  sample_docs/security/accounts.md
7e3164bfef2da2dc41e1018c8cc07287dcbb48f286d9737fc4396a01dc8084e9  sample_docs/security/ai_guideline.md
5c3a9f04bca3c898df3f537e2d40c4383ab03b4a470f238cccb10fa07b137df1  sample_docs/security/infosec.md
```

## 7. 評価後に追加したもの（評価結果には影響しない）

- `export_replays.py`: 評価の記録を Workbench の「実測リプレイ」用に書き出すスクリプト（API は使わない）。調整用（dev）の記録は保存済みの応答から再構成したものなので、処理時間は書き出さない。
