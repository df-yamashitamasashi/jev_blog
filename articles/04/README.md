# Jev Adaptive RAG Workbench (Vol. 4)

[English](#english) | [日本語](#japanese)

---

<a name="japanese"></a>
## 日本語

### 概要
**Jev Adaptive RAG Workbench** は、TypeSafe AI の型安全な意思決定モデル **Jev (System One)** を検索拡張生成 (RAG) の「関所（ゲート）」として組み込んだ、対話型ワークベンチと Python リファレンス実装です。

「検索が必要か」「この文書は使えるか」「根拠は足りているか」といった判断を Jev に任せ、LLM は根拠がそろったときに1回だけ回答を生成します。**5つの System One ゲート**で、ムダな LLM 呼び出しと根拠のない回答を減らします。

### 主な特徴
1. **Gate 1: Intent & Route Guard (Choice)**: 挨拶や曖昧な入力は検索・LLM を使わずに返答。検索先カテゴリも判定。
2. **Gate 2: Query Decomposition (Noul)**: 複合質問をサブクエリに分解して検索（Gate 1 と同じ1回の呼び出しで判定）。
3. **Gate 3: Fast Semantic Reranking (Score)**: 候補パッセージを0〜2点で採点し、1.0未満を除外して LLM に渡すコンテキストを削減。
4. **Gate 4: Context Sufficiency Gate (Noul)**: 根拠が足りないときは LLM を呼ばずに「見つかりませんでした」と返す。
5. **Gate 5: Faithfulness & Citation Guard (Noul)**: 回答を1文ずつ根拠と照合し、引用元と引用忠実性スコアを表示。
6. **APIキー不要で試せる**: キー未設定時は内蔵シミュレータ（文字一致率ベースの簡易判定）で動作。キーを設定すると本物の Jev / OpenAI API を使用。
7. **Clean Architecture**: Domain, UseCases, Adapters, Presentation を分離。

### クイックスタート

#### 1. インタラクティブ・スタジオの起動 (TypeScript + Vite)
```bash
cd articles/04/jev-rag-workbench
npm install
npm run dev
# ブラウザで http://localhost:3000/ にアクセス
```

#### 2. 単体テストの実行 (Vitest)
```bash
npm test
```

#### 3. Python 本番パイプラインの実行
```bash
cd articles/04/python
pip install -r requirements.txt
python rag_pipeline.py
pytest test_rag_pipeline.py -v
```

---

<a name="english"></a>
## English

### Overview
**Jev Adaptive RAG Workbench** is an interactive studio and Python reference implementation that places TypeSafe AI's type-safe decision model **Jev (System One)** as gates inside a Retrieval-Augmented Generation (RAG) pipeline.

Jev makes the decisions ("does this need retrieval?", "is this passage relevant?", "is the context sufficient?"), and the LLM writes an answer only once the evidence is in place. **5 System One gates** cut unnecessary LLM calls and ungrounded answers.

### Key Features
1. **Gate 1: Intent & Route Guard (Choice)**: Answers greetings / asks for clarification without retrieval or LLM calls, and routes to a document category.
2. **Gate 2: Query Decomposition (Noul)**: Splits compound queries into sub-queries for retrieval (decided in the same Jev call as Gate 1).
3. **Gate 3: Fast Semantic Reranking (Score)**: Scores each candidate 0-2 and drops passages below 1.0, shrinking the LLM context.
4. **Gate 4: Context Sufficiency Gate (Noul)**: Returns "not found" instead of calling the LLM when the evidence is insufficient.
5. **Gate 5: Faithfulness & Citation Guard (Noul)**: Checks each generated sentence against the sources and shows citations and an Attribution Score.
6. **Runs without API keys**: Falls back to a built-in heuristic simulator (character-overlap based). Set keys to use the real Jev / OpenAI APIs.
7. **Clean Architecture**: Domain, UseCases, Adapters, and Presentation are separated.

### Quickstart

#### 1. Launch Interactive Studio (TypeScript + Vite)
```bash
cd articles/04/jev-rag-workbench
npm install
npm run dev
# Open http://localhost:3000/ in browser
```

#### 2. Run Test Suite (Vitest)
```bash
npm test
```

#### 3. Run Python Reference Pipeline
```bash
cd articles/04/python
pip install -r requirements.txt
python rag_pipeline.py
pytest test_rag_pipeline.py -v
```

### License
MIT License
