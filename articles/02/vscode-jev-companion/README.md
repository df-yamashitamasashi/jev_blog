# Jev Companion — VSCode Extension

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Clean Architecture](https://img.shields.io/badge/Architecture-Clean%20Architecture-brightgreen.svg)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)]()
[![Vitest](https://img.shields.io/badge/Tested%20with-Vitest-yellow.svg)]()

TypeSafe AI の意思決定モデル **Jev (System One)** を活用した、次世代 VSCode 拡張機能です。
重く遅い生成型 LLM（System Two）を直接エディタのリアルタイムイベントにバインドする代わりに、ミリ秒単位で意思決定を下す Jev をフロントラインに配置し、確信度駆動（Confidence-driven）の高速エディタ体験を実現します。

---

## 主な機能

1. **リアルタイム・セキュリティ & 品質診断 (Speculative Security Diagnostics)**
   - ファイル保存時やコード選択時に、Jev `Noul` / `Score` を用いて潜在的な脆弱性（ハードコードされたシークレット、インジェクションリスク、不適切な例外握りつぶし等）を数十ミリ秒で判定。
   - 確信度（Confidence）がしきい値（デフォルト: `0.85`）以上の確実な問題のみをエディタに波線表示（Diagnostics）し、QuickFix（CodeAction）を提供。
2. **インテリジェント・インテントルーター (Intelligent Intent Dispatcher)**
   - 選択されたコードに対して「テスト生成」「リファクタリング」「ドキュメント作成」「バグ修正」「セキュリティ強化」のどれが最も適しているかを Jev `Choice` でミリ秒分類。
   - 確率分布と確信度をステータスバーやQuickPickに提示し、最適なプロンプトとモデル層へ即座にディスパッチ。
3. **投機的LLMゲートキーパー (Speculative LLM Gatekeeper)**
   - エディタからの高コストなLLM自動呼び出しの前に、「本当に深い推論が必要か？」を Jev `Noul` で事前にゲート判定。不要なLLM APIコールを最大90%削減。

---

## アーキテクチャ設計 (Clean Architecture)

拡張機能のコアロジックは Clean Architecture に基づき、VSCode API と外部依存から完全に疎結合に設計されています。

```
src/
├── domain/                      # 最内周: 純粋なTypeScript型定義・定数（外部依存ゼロ）
│   ├── models.ts                # Jevプリミティブ (Choice, Score, Noul) とエンティティ
│   └── constants.ts             # デフォルト値、しきい値、プロンプト辞書
├── adapters/                    # アダプター層: 外部API通信と設定の抽象化
│   ├── jevClient.ts             # Jev REST API (POST /v1/systemone) クライアント
│   └── configAdapter.ts         # VSCode設定のインターフェース
├── usecases/                    # ユースケース層: コアビジネスロジック
│   ├── securityDiagnosticUseCase.ts  # セキュリティ診断と確信度ゲーティング
│   ├── intentRoutingUseCase.ts       # 意図分類とモデル階層ルーティング
│   └── speculativeGateUseCase.ts     # LLM実行要否の二値判定
├── vscode/                      # 外周: VSCode Presentation 層
│   ├── diagnosticProvider.ts    # DiagnosticsCollection 連携
│   ├── codeActionProvider.ts    # クイックフィックス (CodeAction)
│   ├── commands.ts              # コマンドパレットハンドラー
│   └── statusBar.ts             # ステータスバー表示
└── extension.ts                 # エントリポイント (activate / deactivate)
```

---

## セットアップと開発手順

### 前提条件
- Node.js >= 18.0.0
- npm >= 9.0.0
- VSCode >= 1.85.0

### インストール
```bash
cd articles/02/vscode-jev-companion
npm install
```

### 単体テストの実行 (Vitest)
VSCode を起動することなく、モックを用いた高速な単体テストを実行できます。
```bash
npm test
```

### ビルド
TypeScript のコンパイルを行います（`dist/` 配下に JS を出力）：
```bash
npm run build
```

### VSCode でのデバッグ実行 (Run Extension)
1. VSCode で `articles/02/vscode-jev-companion` を開きます。
2. `F5` キー（または「実行とデバッグ」タブから「Extension」）を実行します。
3. 新しく起動した「拡張機能開発ホスト」ウィンドウで、任意のコードファイルを開き、以下のコマンドを試すことができます：
   - `Cmd+Shift+P` -> `Jev: Analyze Selected Code`
   - `Cmd+Shift+P` -> `Jev: Smart Intent Dispatcher`

---

## 設定項目 (`settings.json`)

| キー | 型 | デフォルト値 | 説明 |
| :--- | :--- | :--- | :--- |
| `jev.apiKey` | `string` | `""` | TypeSafe AI API Key（環境変数 `TYPESAFE_API_KEY` からも自動読み込み可） |
| `jev.baseUrl` | `string` | `https://api.typesafe.ai` | TypeSafe AI API のベースURL |
| `jev.model` | `string` | `jev-latest` | 使用する Jev モデル名 |
| `jev.confidenceThreshold` | `number` | `0.85` | 診断を波線表示するための最小確信度（0.0 〜 1.0） |
| `jev.enableOnSave` | `boolean` | `true` | ファイル保存時に自動でセキュリティ診断を実行するか |
| `jev.enableSpeculativeGate` | `boolean` | `true` | 高コストなLLM呼び出しをJevで投機的にゲートするか |
