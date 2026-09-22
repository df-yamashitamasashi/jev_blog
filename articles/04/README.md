# Jev Adaptive RAG Workbench (Vol. 4)

[English](#english) | [日本語](#japanese)

---

<a name="japanese"></a>
## 日本語

### 概要
**Jev Adaptive RAG Workbench** は、TypeSafe AI が提供する超高速・型安全意思決定モデル **Jev (System One)** を検索拡張生成 (RAG) に組み込んだ、次世代のプロダクション品質パイプラインおよび対話型ワークベンチです。

従来の Naive RAG や LLM 自己判定型 RAG (Self-RAG/CRAG) が抱える「高遅延・高トークンコスト・ハルシネーション」の壁を、**5つの System One 意思決定ゲート** によって打破します。

### 主な特徴
1. **Gate 1: Intent & Route Guard (Choice)**: 挨拶や検索不要なクエリを数msで早期リターン（検索・LLMコスト100%カット）。
2. **Gate 2: Query Decomposition (Noul)**: 複合トピック質問をサブクエリに分解して取りこぼし防止。
3. **Gate 3: Fast Semantic Reranking (Score)**: 候補パッセージを瞬時に0〜2点で採点し、ノイズを足切りしてトークンを60〜80%削減。
4. **Gate 4: Context Sufficiency Gate (Noul)**: ナレッジ不足時にLLM生成を安全にスキップ（ゼロハルシネーション）。
5. **Gate 5: Faithfulness & Citation Guard (Noul)**: LLM生成文を文単位で事実検証し、引用忠実性スコアを付与。
6. **APIキー不要**: 内蔵シミュレーターにより、APIキー未設定でも本番と同一の推論挙動で即座に動作。
7. **Clean Architecture**: Domain, UseCases, Adapters, Presentation を完全分離。

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
**Jev Adaptive RAG Workbench** is a production-grade pipeline and interactive studio that integrates TypeSafe AI's high-speed, type-safe decision model **Jev (System One)** into Retrieval-Augmented Generation (RAG).

It overcomes the high latency, high token cost, and hallucination issues of Naive RAG and LLM-based Self-RAG/CRAG through **5 System One Decision Gates**.

### Key Features
1. **Gate 1: Intent & Route Guard (Choice)**: Early-returns non-search queries in milliseconds, eliminating 100% of unneeded search and LLM costs.
2. **Gate 2: Query Decomposition (Noul)**: Decomposes multi-topic queries into sub-queries to prevent information loss.
3. **Gate 3: Fast Semantic Reranking (Score)**: Instant 0-2 relevance scoring that compresses context tokens by 60-80%, eliminating Lost-in-the-Middle degradation.
4. **Gate 4: Context Sufficiency Gate (Noul)**: Skips LLM generation when knowledge is absent, achieving Zero Hallucination.
5. **Gate 5: Faithfulness & Citation Guard (Noul)**: Sentence-level factual verification providing Attribution Scores.
6. **Zero API Key Requirement**: Built-in offline simulator reproduces identical decision distributions and latencies without configuration.
7. **Clean Architecture**: Strict separation across Domain, UseCases, Adapters, and Presentation.

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
