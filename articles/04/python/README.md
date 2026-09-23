# jev_rag — Jev Adaptive RAG (Python)

社内文書に答える RAG です。「答えるべきか」「どの文書が使えるか」「根拠は十分か」「回答は文書どおりか」の判断を **Jev（TypeSafe AI）** が行い、回答文の作成だけを **LLM（Gemini）** が行います。

- 1回の質問で Jev を呼ぶのは **最大3回**（挨拶なら1回、答えのない質問なら2回）
- 文書に答えがない質問は **LLM を呼ばずに**「見つかりませんでした」と返す
- 回答は1文ずつ文書と照合し、根拠を確認できない文に印を付ける
- 閲覧権限、監査ログ、障害時の動作、しきい値をすべて設定で変更可能

評価の方法と結果は [evaluation/README.md](evaluation/README.md) と記事本文を参照してください。

## 1. インストール

```bash
cd articles/04/python
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

export TYPESAFE_API_KEY=...   # Jev
export GEMINI_API_KEY=...     # 回答生成と Embedding
```

Python 3.10 以上が必要です。

## 2. 自分の文書で使う

```bash
# 1) 文書フォルダからインデックスを作る（Markdown / テキスト / PDF）
python -m jev_rag ingest ./sample_docs --index index.json

# 2) 質問する
python -m jev_rag ask "使い切れなかった有休は来年に持ち越せる？" --index index.json

# 3) HTTP API として動かす（POST /ask, GET /healthz）
python -m jev_rag serve --index index.json --port 8000
```

`ask` の出力例（実際の実行結果）:

```
当年度に使い切れなかった年次有給休暇は、翌年度に限り繰り越すことができます [1]。ただし、繰り越せる日数の上限は20日までとなっており、上限を超えた日数は消滅します [1]。

参照:
  [1] 休暇規程 > 第4条 年次有給休暇の繰り越し  (hr/leave.md)

[answered] 2731 ms / Jev 3 calls / LLM 392 tokens
```

閲覧権限のある文書は、`--groups` で利用者のグループを渡したときだけ検索対象になります。

```bash
python -m jev_rag ask "賞与の算定係数は？" --index index.json                    # → 見つかりませんでした
python -m jev_rag ask "賞与の算定係数は？" --index index.json --groups hr_admin  # → S評価1.5、A評価1.2 …
```

### 文書の書き方

見出し（`#`, `##`, `###`）ごとに分割されます。1節が長い場合は400文字程度で分割します。先頭に次のような設定（front matter）を書けます。どれも省略できます。

```markdown
---
title: 休暇規程
category: hr
access: [hr_admin]   # 省略すると全員が閲覧可
---
# 休暇規程
## 第4条 年次有給休暇の繰り越し
...
```

文書フォルダに `categories.json`（`{"hr": "人事・労務に関する社内規程", ...}`）を置くと、Gate 1 が質問の分野を判定します（判定結果は監査ログに残ります。`JEV_RAG_USE_ROUTING=true` で検索の絞り込みにも使います）。

## 3. Python から使う

```python
from jev_rag.app import load_pipeline

pipeline = load_pipeline("index.json")
answer = pipeline.ask("在宅勤務手当はいくら？", user_groups=["hr_admin"])

answer.status  # answered / no_answer / direct / clarify / unavailable
answer.text  # 回答（[1] のような引用番号つき）
answer.citations  # 引用元のチャンク（[1] が citations[0]）
answer.unsupported_claims  # 根拠を確認できなかった文
answer.timings_ms, answer.jev_calls, answer.llm_tokens
```

LLM や Embedding を別のサービスに替える場合は、`jev_rag.gemini.Generator` / `jev_rag.retrieval.Embedder` と同じメソッドを持つクラスを作り、`JevRagPipeline` に渡してください。

## 4. 設定

すべて環境変数 `JEV_RAG_<項目名>` で上書きできます（`jev_rag/config.py`）。

| 項目 | 既定値 | 説明 |
| :--- | :--- | :--- |
| `JEV_MODEL` | `jev-1.13.0` | Jev のモデル（評価したバージョンに固定） |
| `GENERATION_MODEL` | `gemini-3.8-flash` | 回答生成モデル |
| `EMBEDDING_MODEL` | `gemini-embedding-2` | Embedding モデル（変更したら `ingest` し直す） |
| `TOP_K` | `5` | 検索で取り出すチャンク数 |
| `RELEVANCE_THRESHOLD` | `1.0` | Gate 3: この点数（0〜2）未満のチャンクは LLM に渡さない |
| `SUFFICIENCY_THRESHOLD` | `0.70` | Gate 4: 「答えられる」確率がこれ未満なら回答しない |
| `SUPPORT_THRESHOLD` | `0.80` | Gate 5: 「文書で裏付けられる」確率がこれ未満の文に印を付ける |
| `INTENT_CONFIDENCE_THRESHOLD` | `0.50` | Gate 1: 「挨拶」「曖昧」の判定がこの確信度未満なら、文書を調べる |
| `USE_ROUTING` | `false` | Gate 1 の分野判定で検索を絞り込む |
| `FAIL_MODE` | `closed` | Jev に接続できないとき。`closed`＝回答しない / `open`＝検証なしで回答 |
| `UNSUPPORTED_POLICY` | `flag` | 根拠のない文を `flag`＝印を付けて残す / `remove`＝削除する |
| `AUDIT_LOG_PATH` | なし | 設定すると、質問ごとの判定内容を JSONL で追記する |
| `AUDIT_LOG_QUERY_TEXT` | `true` | 監査ログに質問文そのものを残すか |

## 5. 本番導入のチェックリスト

- [ ] **文書の送信先**: 文書の内容は TypeSafe（Jev）と Google（Gemini）に送られます。社内の規則と各社の契約条件を確認してください。
- [ ] **閲覧権限**: 利用者のグループ（SSO などから取得）を `user_groups` に渡してください。`serve` の API には認証がないため、社内の認証基盤の後ろに置いてください。
- [ ] **自社データでの評価**: `evaluation/` の手順で、自社の文書と質問（答えのない質問を必ず含める）を使って評価し、しきい値を決めてください。
- [ ] **規模**: インデックスは JSON ファイル1つで、検索は全件計算です。目安として数万チャンクを超える場合は、`VectorIndex` を pgvector などのベクトルDBに置き換えてください。
- [ ] **文書の更新**: 文書を変えたら `ingest` をやり直してください（差分更新は未対応）。
- [ ] **対象外の機能**: 会話履歴（「それは？」のような続けての質問）、ストリーミング表示、画像だけの PDF の文字認識は含まれていません。

## 6. テスト

```bash
pytest -q   # API キー不要（Jev / Gemini は偽物に差し替えて実行）
```

## ファイル構成

```
python/
├── jev_rag/               # 実用版パッケージ
│   ├── documents.py       # 文書の読み込み・見出し単位の分割・閲覧権限
│   ├── retrieval.py       # BM25（文字バイグラム）＋ベクトル検索、RRF で統合
│   ├── gates.py           # Jev の5つのゲート（最大3回の呼び出し）
│   ├── gemini.py          # 回答生成と Embedding
│   ├── pipeline.py        # 全体の流れ、障害時の動作、監査ログ
│   ├── app.py / __main__.py / server.py   # 組み立て、CLI、HTTP API
│   └── config.py          # 設定
├── sample_docs/           # 評価に使った架空の社内文書（20件）
├── evaluation/            # 評価の手順・データ・結果
├── rag_pipeline.py        # 1ファイルで読める最小版（オフラインのシミュレータ付き）
└── test_*.py
```
