# Jev Tech Blog & Practice Code Hub

TypeSafe AI の意思決定モデル **「Jev」（System One）** に関する技術記事シリーズと、そのサンプルコードのリポジトリです。

Jev は文章を生成せず、型の決まった質問（選択・段階評価・Yes/No）に確率で答えるモデルです。各記事では、生成型 LLM（System Two）と Jev をどう役割分担させるかを、動くコードとともに解説しています。

---

## 記事シリーズ & サンプルコード一覧

| シリーズ | テーマ | 主な技術スタック | サンプルコード |
| :--- | :--- | :--- | :--- |
| **Vol. 1** | [**Jev詳解（実践ユースケース5選）**](https://qiita.com/yam_dev/items/e3c69dbb3aec67f092c4)<br>サポートトリアージ、セキュリティガードレール、モデルルーター、RAGリランク、エージェントスキル選択 | Python 3.12<br>`typesafe-sdk`<br>pytest, mypy, ruff | [`articles/01/`](./articles/01/) |
| **Vol. 2** | [**Jevを活用したVSCode拡張機能の構築**](https://qiita.com/yam_dev/items/018959baefb3bee4a06a)<br>リアルタイム波線診断、インテントディスパッチャー、投機的LLMゲートキーパー | TypeScript<br>Clean Architecture<br>VSCode API, Vitest | [`articles/02/vscode-jev-companion/`](./articles/02/vscode-jev-companion/) |
| **Vol. 3** | [**Jevで創るリアルタイム・レトロダンジョンバトル**](https://qiita.com/yam_dev/items/4c0ff700a6b265f96c8a)<br>AIゲームディレクター、パレットスワップ、リアルタイム装備成長、レトロTCGカード生成＆シェア | TypeScript<br>Clean Architecture<br>Vite, HTML5 Canvas, Web Audio, Vitest | [`articles/03/`](./articles/03/) |
| **Vol. 4** | [**Jevで作る検証用RAG**](https://qiita.com/yam_dev/items/a7aafeab9854dedfc294)<br>判断は Jev・文章は LLM に分けた RAG。本物の API で60問を評価し、「誰が何をしたか」をフロー図で可視化 | Python（`typesafe-sdk`, Gemini）<br>TypeScript, Vite<br>pytest, Vitest | [`articles/04/`](./articles/04/) |
| **Vol. 5** | [**[Jev/Gemini/Claude] エアホッケー最強決定戦**](./articles/05/README.md)<br>全AI共通の選択式質問プロトコル、試合前プレイブック、総当たりトーナメント、120Hz物理演算と10サブステップ連続衝突判定（CCD） | TypeScript<br>Clean Architecture<br>Vite, HTML5 Canvas, Web Audio, Vitest | [`articles/05/`](./articles/05/) |

---

## リポジトリ構成

```
jev_blog/
├── README.md                           # 本ドキュメント
└── articles/
    ├── 01/                             # Vol. 1: Jev詳解（ユースケース5選）
    │   ├── 00_quickstart.py            # クイックスタート (Noul)
    │   ├── 01_ticket_triage.py         # サポートチケット自動トリアージ
    │   ├── 02_security_guardrails.py   # LLM入出力セキュリティガードレール
    │   ├── 03_model_router.py          # モデルルーター
    │   ├── 04_rag_rerank_citation.py   # RAGリランキング & 引用事実性検証
    │   ├── 05_agent_skill_router.py    # エージェント・スキルルーター
    │   ├── test_usecases.py            # 単体テスト
    │   └── requirements.txt
    ├── 02/                             # Vol. 2: VSCode拡張機能
    │   └── vscode-jev-companion/       # 「Jev Companion」拡張機能本体
    ├── 03/                             # Vol. 3: レトロダンジョンRPG
    │   ├── README.md
    │   └── jev-retro-dungeon/          # ゲーム本体（index.html）& モンスターギャラリー（gallery.html）
    ├── 04/                             # Vol. 4: Jevで作る検証用RAG
    │   ├── README.md
    │   ├── images/                     # 記事のスクリーンショット
    │   ├── python/
    │   │   ├── jev_rag/                # RAG本体（取り込み・検索・Jevゲート・Gemini生成・CLI・HTTP API）
    │   │   ├── evaluation/             # 本物のAPIでの評価（手順・データ・記録）
    │   │   ├── sample_docs/            # 評価に使った架空の社内文書
    │   │   └── rag_pipeline.py         # 1ファイルで読める最小版
    │   └── jev-rag-workbench/          # 動作フローの可視化（評価記録の再生）
    └── 05/                             # Vol. 5: エアホッケー最強決定戦
        ├── README.md
        └── jev-air-hockey/             # ゲーム本体 & テレメトリHUD
```

---

## クイックスタート

### 共通前提

TypeSafe AI の API キーを取得し、環境変数 `TYPESAFE_API_KEY` に設定してください。Vol. 3〜5 は、キーが未設定でも内蔵シミュレータや記録の再生で動作を確認できます。

```bash
export TYPESAFE_API_KEY="your-typesafe-api-key"
```

### 1. Python サンプルコード (Vol. 1)

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r articles/01/requirements.txt
pytest articles/01/test_usecases.py
```

### 2. VSCode拡張機能 (Vol. 2)

```bash
cd articles/02/vscode-jev-companion
npm install
npm test

# ビルド & VSIX パッケージ作成
npm run build
npm run package

# VSCode にインストール
code --install-extension jev-companion-0.1.0.vsix
```

VSCode の設定（`Cmd+,`）で `jev` を検索し、**`Jev: Api Key`** に API キーを入力してください（環境変数 `TYPESAFE_API_KEY` でも可）。詳細は [拡張機能README](./articles/02/vscode-jev-companion/README.md) をご覧ください。

### 3. レトロダンジョンRPG (Vol. 3)

```bash
cd articles/03/jev-retro-dungeon
npm install
npm test
npm run dev
```

`http://localhost:3000/` でゲーム、`http://localhost:3000/gallery.html` でモンスターギャラリーが開きます。詳細は [ゲームREADME](./articles/03/README.md) をご覧ください。

### 4. Jevで作る検証用RAG (Vol. 4)

```bash
# 動作フローの可視化（API キー不要。本物の API で評価した記録を再生）
cd articles/04/jev-rag-workbench
npm install
npm run dev
# http://localhost:3000/?replay=t02 を開く
```

```bash
# RAG 本体（TYPESAFE_API_KEY と GEMINI_API_KEY が必要）
cd articles/04/python
pip install -r requirements.txt
python -m jev_rag ingest ./sample_docs --index index.json
python -m jev_rag ask "使い切れなかった有休は来年に持ち越せる？" --index index.json
```

詳細は [RAG README](./articles/04/README.md) をご覧ください。

### 5. エアホッケー最強決定戦 (Vol. 5)

```bash
cd articles/05/jev-air-hockey
npm install
npm test
npm run dev
```

`http://localhost:5174/` で対戦画面が開きます。詳細は [エアホッケーREADME](./articles/05/README.md) をご覧ください。

---

## リポジトリの運用方針 (Fork & Clone Only)

本リポジトリは記事の解説・参照用コードハブとして公開されており、**「Fork および Clone 専用」**として運用されています。

- **Fork / Clone**: ご自身の GitHub アカウントへの Fork やローカル環境への Clone は自由に行っていただけます。
- **PR / Issue**: リポジトリ本体への Pull Request、Issue、Discussions の投稿は受け付けておりません。機能拡張や改変は、ご自身の Fork 先リポジトリにてお楽しみください。

---

## ライセンス

本リポジトリのコードおよびサンプルプロジェクトは、すべて **[MIT License](LICENSE)** のもとで公開されています。商用・非商用を問わず自由にご利用いただけます。
