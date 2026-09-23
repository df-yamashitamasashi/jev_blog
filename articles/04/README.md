# Jev Adaptive RAG (Vol. 4)

[日本語](#japanese) | [English](#english)

---

<a name="japanese"></a>
## 日本語

### 概要
「判断は Jev、文章は LLM」という設計を確かめるための **検証用 RAG** です。社内文書に答える RAG で、「答えるべきか」「どの文書が使えるか」「根拠は足りるか」「回答は文書どおりか」を **Jev（TypeSafe AI の意思決定モデル）** が判断し、LLM（Gemini）は回答文を書くだけにしています。

| フォルダ | 内容 |
| :--- | :--- |
| [`python/jev_rag/`](python/README.md) | RAG 本体（文書の取り込み、ハイブリッド検索、5つの Jev ゲート、Gemini による回答生成、閲覧権限、監査ログ、CLI、HTTP API） |
| [`python/evaluation/`](python/evaluation/README.md) | 本物の Jev / Gemini で行った評価（質問68問）の手順・データ・結果 |
| `jev-rag-workbench/` | 動作の可視化。利用者・Jev・検索・LLM の誰が何をしたかを、フロー図で表示する。評価の記録を API キーなしで再生できる |
| `images/` | 記事で使っているスクリーンショット |

### 評価結果（jev-1.13.0 + gemini-3.8-flash、本番評価60問）
- 答えのない質問 20/20 を、LLM に渡さずに止めた
- 答えのある質問 34問中32問に正しく回答（2問を取りこぼし）
- 文書にない内容を含む文 20/20 を検出、正しい文を誤って疑ったのは 0/20
- LLM の呼び出し 60回→32回、LLM のトークン −66%
- 答えを返す場合は、ゲートなしより約0.7秒遅い

### クイックスタート

```bash
# 動作の可視化（API キー不要）
cd articles/04/jev-rag-workbench
npm install && npm run dev
# http://localhost:3000/?replay=t02 を開く

# RAG 本体（TYPESAFE_API_KEY と GEMINI_API_KEY が必要）
cd articles/04/python
pip install -r requirements.txt
python -m jev_rag ingest ./sample_docs --index index.json
python -m jev_rag ask "使い切れなかった有休は来年に持ち越せる？" --index index.json

# テスト（API キー不要）
pytest -q                          # articles/04/python
npm test                           # articles/04/jev-rag-workbench
```

---

<a name="english"></a>
## English

### Overview
A **RAG for verifying one design idea**: *Jev decides, the LLM writes.* Jev (TypeSafe AI's decision model) decides whether to answer, which passages are usable, whether the evidence is sufficient, and whether each generated sentence is supported. The LLM (Gemini) only writes the answer.

| Folder | Contents |
| :--- | :--- |
| [`python/jev_rag/`](python/README.md) | The RAG package: ingestion, hybrid search, five Jev gates, Gemini generation, access control, audit log, CLI, HTTP API |
| [`python/evaluation/`](python/evaluation/README.md) | Evaluation protocol, data (68 questions) and results with the real Jev / Gemini APIs |
| `jev-rag-workbench/` | Visualizer showing who (user / Jev / search / LLM) did what, as a swimlane flow diagram. Replays the recorded runs without API keys |
| `images/` | Screenshots used in the article |

### Results (jev-1.13.0 + gemini-3.8-flash, 60 test questions)
- Stopped 20/20 unanswerable questions before calling the LLM
- Answered 32 of 34 answerable questions correctly (2 were wrongly stopped)
- Flagged 20/20 unsupported sentences, with 0/20 false alarms on supported ones
- LLM calls 60 → 32, LLM tokens −66%
- About 0.7 s slower than an ungated RAG when an answer is returned

### Quickstart

```bash
# Visualizer (no API keys)
cd articles/04/jev-rag-workbench && npm install && npm run dev   # open /?replay=t02

# RAG package (needs TYPESAFE_API_KEY and GEMINI_API_KEY)
cd articles/04/python && pip install -r requirements.txt
python -m jev_rag ingest ./sample_docs --index index.json
python -m jev_rag ask "有休の繰り越し上限は？" --index index.json
```

### License
MIT License
