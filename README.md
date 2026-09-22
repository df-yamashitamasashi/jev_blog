# Jev Tech Blog & Practice Code Hub

TypeSafe AI が発表した新世代の意思決定モデル **「Jev」（System One）** に関する技術解説記事シリーズと、本番運用を想定した実践サンプルコード・拡張機能のリポジトリです。

従来の生成型 LLM（System Two: 熟慮型）が抱える「高レイテンシ・高コスト・非決定性」の壁を、直感的・即時的判断を下す「Jev」を適材適所で組み合わせることでどのように打破できるかを、具体的な動作コードとともに解説しています。

---

## 記事シリーズ & サンプルコード一覧

| シリーズ | テーマ | 主な技術スタック | サンプルコード |
| :--- | :--- | :--- | :--- |
| **Vol. 1** | [**Jev詳解（実践ユースケース5選）**](https://qiita.com/yam_dev/items/e3c69dbb3aec67f092c4)<br>サポートトリアージ、セキュリティガードレール、モデルルーター、RAGリランク、エージェントスキル選択 | Python 3.12<br>`typesafe-sdk`<br>pytest, mypy, ruff | [`articles/01/`](./articles/01/) |
| **Vol. 2** | [**Jevを活用したVSCode拡張機能の構築**](https://qiita.com/yam_dev/items/018959baefb3bee4a06a)<br>リアルタイム波線診断、インテントディスパッチャー、投機的LLMゲートキーパー | TypeScript<br>Clean Architecture<br>VSCode API, Vitest | [`articles/02/vscode-jev-companion/`](./articles/02/vscode-jev-companion/) |
| **Vol. 3** | [**Jevで創るリアルタイム・レトロダンジョンバトル**](https://qiita.com/yam_dev/items/4c0ff700a6b265f96c8a)<br>AIゲームディレクター、パレットスワップ、リアルタイム装備成長、レトロTCGカード生成＆シェア | TypeScript<br>Clean Architecture<br>Vite, HTML5 Canvas, Web Audio, Vitest | [`articles/03/`](./articles/03/) |
| **Vol. 4** | **Jevを活用したRAGの構築**<br>5-Stage System One ゲート、超低遅延・トークン70%削減・ゼロハルシネーション、A/Bベンチマーク | TypeScript / Python<br>Clean Architecture<br>Vite, In-Memory Hybrid Search, Vitest, pytest | [`articles/04/`](./articles/04/) |
| **Vol. 5** | **Jevを活用したエージェントの構築** *(Coming Soon)* | - | `articles/05/` *(準備中)* |

---

## リポジトリ構成

```
jev_blog/
├── README.md                           # 本ドキュメント
├── articles/
│   ├── 01/                             # Vol. 1: Jev詳解（ユースケース5選）
│   │   ├── 00_quickstart.py            # クイックスタート (Noul)
│   │   ├── 01_ticket_triage.py         # サポートチケット自動トリアージ
│   │   ├── 02_security_guardrails.py   # LLM入出力セキュリティガードレール
│   │   ├── 03_model_router.py          # インテリジェント・モデルルーター
│   │   ├── 04_rag_rerank_citation.py   # RAGリランキング & 引用事実性検証
│   │   ├── 05_agent_skill_router.py    # エージェント・スキルルーター
│   │   ├── test_usecases.py            # 全ユースケースの単体テスト
│   │   └── requirements.txt            # Python依存パッケージ
│   ├── 02/                             # Vol. 2: VSCode拡張機能
│   │   └── vscode-jev-companion/       # 「Jev Companion」拡張機能本体 (Clean Architecture)
│   │       ├── package.json
│   │       ├── tsconfig.json
│   │       ├── vitest.config.ts
│   │       ├── README.md               # 拡張機能の詳細ドキュメント
│   │       ├── src/                    # Domain, Adapters, UseCases, VSCode Presentation
│   │       └── test/                   # Vitest 単体テストスイート (12 tests)
│   ├── 03/                             # Vol. 3: 王道レトロダンジョンRPG (2.2億通りDNAモンスター & BGM自動作曲)
│   │   ├── 03_jev_retro_dungeon_game.md # 技術解説記事
│   │   ├── README.md                   # バイリンガル（英日）詳細ドキュメント
│   │   └── jev-retro-dungeon/          # ゲーム本体 & ギャラリー (Clean Architecture)
│   │       ├── package.json
│   │       ├── index.html              # レトロUI & CRTスキャンライン
│   │       ├── gallery.html            # 2.2億通りDNAモンスター検証ギャラリー
│   │       ├── src/                    # Domain, Adapters, UseCases, Presentation
│   │       └── test/                   # Vitest 単体テストスイート (4ファイル・22 tests)
│   ├── 04/                             # Vol. 4: Jev Adaptive RAG Workbench (5-Stage System One Studio)
│   │   ├── 04_jev_rag_architecture.md  # 技術解説記事 (Qiita)
│   │   ├── README.md                   # バイリンガル（英日）詳細ドキュメント
│   │   ├── jev-rag-workbench/          # 対話型スタジオ (Clean Architecture)
│   │   │   ├── package.json
│   │   │   ├── index.html              # ガラスモーフィズム・リアルタイム可視化UI
│   │   │   ├── src/                    # Domain, Adapters, UseCases, Presentation
│   │   │   └── test/                   # Vitest 単体テストスイート (5ファイル・13 tests)
│   │   └── python/                     # Python本番パイプライン
│   │       ├── rag_pipeline.py         # Clean Architecture準拠パイプライン
│   │       ├── test_rag_pipeline.py    # pytest 単体テストスイート (4 tests)
│   │       └── requirements.txt
└── docs/                               # 開発ログ・設計ドキュメント
```

---

## クイックスタート

### 共通前提
TypeSafe AI の API キーを取得し、環境変数 `TYPESAFE_API_KEY` に設定してください（※未設定の場合でも内蔵シミュレーターにより即座にプレイ・動作確認が可能です）。
```bash
export TYPESAFE_API_KEY="your-typesafe-api-key"
```

### 1. Python サンプルコードの実行 (Vol. 1)
```bash
# 仮想環境の作成とアクティベート
python3 -m venv .venv
source .venv/bin/activate

# 依存パッケージのインストール
pip install -r articles/01/requirements.txt

# 単体テストの実行
pytest articles/01/test_usecases.py
```

### 2. VSCode拡張機能の導入 & 実行 (Vol. 2)
```bash
cd articles/02/vscode-jev-companion

# 依存パッケージのインストール & 単体テスト
npm install
npm test

# ビルド & VSIX パッケージ作成
npm run build
npm run package

# 普段使いの VSCode にインストール
code --install-extension jev-companion-0.1.0.vsix
```

#### 初期設定 (APIキー)
VSCode 画面左下の歯車アイコン ⚙️ ->「設定」（または `Cmd+,`）から `jev` を検索し、**`Jev: Api Key`** に取得した API キーを入力（または環境変数 `TYPESAFE_API_KEY` を設定）すれば完了です。
詳細は [拡張機能README](./articles/02/vscode-jev-companion/README.md) をご覧ください。

### 3. Jev レトロダンジョンRPGの起動 (Vol. 3)
```bash
cd articles/03/jev-retro-dungeon

# 依存パッケージのインストール & 単体テスト (22 tests 全パス)
npm install
npm test

# 開発用ローカルサーバーの起動 (Vite)
npm run dev
```

ブラウザで `http://localhost:3000/` を開くとゲームが起動します。
また、`http://localhost:3000/gallery.html` で2.2億通りのDNAモンスターを心ゆくまで生成・検証できるモンスターギャラリーを利用可能です。
詳細は [ゲームREADME](./articles/03/README.md) をご覧ください。

### 4. Jev Adaptive RAG Workbench の起動 (Vol. 4)
```bash
cd articles/04/jev-rag-workbench

# 依存パッケージのインストール & 単体テスト (13 tests 全パス)
npm install
npm test

# インタラクティブ・スタジオの起動 (Vite)
npm run dev
```

ブラウザで `http://localhost:3000/` を開くと、5段階の Jev System One 意思決定ゲート（トリアージ、クエリ分解、高速リランク、十分性判定、引用事実検証）がリアルタイムにステップ可視化されるワークベンチが起動します。
また、自社システムにそのまま組み込める Python 実装も即座に実行可能です：
```bash
cd articles/04/python
pytest test_rag_pipeline.py -v
python rag_pipeline.py
```
詳細は [RAG README](./articles/04/README.md) をご覧ください。

---

## リポジトリの運用方針 (Fork & Clone Only)

本リポジトリは記事の解説・参照用コードハブとして公開されており、**「Fork および Clone 専用」**として運用されています。

- **Fork / Clone**: ご自身の GitHub アカウントへの Fork やローカル環境への Clone は自由に行っていただけます。
- **PR / Issue**: リポジトリ本体への Pull Request、Issue、Discussions の投稿は受け付けておりません。機能拡張や改変は、ご自身の Fork 先リポジトリにてお楽しみください。

---

## ライセンス

本リポジトリのコードおよびサンプルプロジェクトは、すべて **[MIT License](LICENSE)** のもとで公開されています。商用・非商用を問わず自由にご利用いただけます。
