# Jev Tech Blog & Practice Code Hub

TypeSafe AI が発表した新世代の意思決定モデル **「Jev」（System One）** に関する技術解説記事シリーズと、本番運用を想定した実践サンプルコード・拡張機能のリポジトリです。

従来の生成型 LLM（System Two: 熟慮型）が抱える「高レイテンシ・高コスト・非決定性」の壁を、直感的・即時的判断を下す「Jev」を適材適所で組み合わせることでどのように打破できるかを、具体的な動作コードとともに解説しています。

---

## 記事シリーズ & サンプルコード一覧

| シリーズ | テーマ | 主な技術スタック | サンプルコード |
| :--- | :--- | :--- | :--- |
| **Vol. 1** | **Jev詳解（実践ユースケース5選）**<br>サポートトリアージ、セキュリティガードレール、モデルルーター、RAGリランク、エージェントスキル選択 | Python 3.12<br>`typesafe-sdk`<br>pytest, mypy, ruff | [`articles/01/`](./articles/01/) |
| **Vol. 2** | **Jevを活用したVSCode拡張機能の構築**<br>リアルタイム波線診断、インテントディスパッチャー、投機的LLMゲートキーパー | TypeScript<br>Clean Architecture<br>VSCode API, Vitest | [`articles/02/vscode-jev-companion/`](./articles/02/vscode-jev-companion/) |
| **Vol. 3** | **Jevを活用したRAGの構築** *(Coming Soon)* | Python / TypeScript | `articles/03/` *(準備中)* |
| **Vol. 4** | **Jevを活用した複雑なプロンプトの構築** *(Coming Soon)* | - | `articles/04/` *(準備中)* |
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
│   └── 02/                             # Vol. 2: VSCode拡張機能
│       └── vscode-jev-companion/       # 「Jev Companion」拡張機能本体 (Clean Architecture)
│           ├── package.json
│           ├── tsconfig.json
│           ├── vitest.config.ts
│           ├── README.md               # 拡張機能の詳細ドキュメント
│           ├── src/                    # Domain, Adapters, UseCases, VSCode Presentation
│           └── test/                   # Vitest 単体テストスイート (12 tests)
└── docs/                               # 開発ログ・設計ドキュメント
```

---

## クイックスタート

### 共通前提
TypeSafe AI の API キーを取得し、環境変数 `TYPESAFE_API_KEY` に設定してください。
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

### 2. VSCode拡張機能のビルド & テスト (Vol. 2)
```bash
cd articles/02/vscode-jev-companion

# 依存パッケージのインストール
npm install

# 単体テストの実行 (Vitest)
npm test

# ビルド
npm run build

# VSIX パッケージの作成と VSCode へのインストール
npm run package
code --install-extension jev-companion-0.1.0.vsix
```

---

## ライセンス

本リポジトリのコードは [MIT License](LICENSE) のもとで公開されています。
