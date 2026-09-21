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

---

## VSCodeへの導入方法 (Installation & Setup)

日常利用するVSCodeに本拡張機能「Jev Companion」を導入し、有効化するまでの手順です。

### 1. インストール手順（3つの方法から選択）

#### 方法 A: VSIX パッケージからインストール（一番おすすめ・普段使い向け）
配布用 `.vsix` ファイルを作成し、VSCodeに正式にインストールします。

```bash
# 1. リポジトリをクローンして移動
git clone https://github.com/df-yamashitamasashi/jev_blog.git
cd jev_blog/articles/02/vscode-jev-companion

# 2. 依存関係のインストールとビルド
npm install
npm run build

# 3. VSIX パッケージの作成 (jev-companion-0.1.0.vsix が生成されます)
npm run package

# 4. VSCode にインストール (CLI)
code --install-extension jev-companion-0.1.0.vsix
```

> **GUI からインストールする場合:**
> 1. VSCode のサイドバーで「拡張機能」アイコン（`Cmd+Shift+X` / `Ctrl+Shift+X`）を開きます。
> 2. 拡張機能ペイン右上の「**…**」（その他のアクション）メニューをクリックします。
> 3. 「**VSIX からのインストール... (Install from VSIX...)**」を選択し、生成された `jev-companion-0.1.0.vsix` を選択します。

#### 方法 B: ローカル拡張機能フォルダへのシンボリックリンク（開発しながら常用）
ソースコードを変更しながら常用したい場合は、VSCodeの拡張機能ディレクトリへシンボリックリンクを張ります。
```bash
# macOS / Linux
ln -s "$(pwd)" ~/.vscode/extensions/jev-companion

# Windows (PowerShell 管理者権限)
# New-Item -ItemType SymbolicLink -Path "$HOME\.vscode\extensions\jev-companion" -Target (Get-Location)
```
リンク設定後、VSCodeを再起動するか `Cmd+Shift+P` -> `Developer: Reload Window` を実行します。

#### 方法 C: 開発ホストでの一時デバッグ実行 (F5)
1. VSCode で `articles/02/vscode-jev-companion` フォルダを開きます。
2. `F5` キー（または「実行とデバッグ」タブから「Extension」）を実行します。
3. 起動した「拡張機能開発ホスト」ウィンドウで、任意のコードを開いて動作を試せます。

---

### 2. 初期設定（APIキーの設定）

Jev Companion の判定エンジンを利用するには、TypeSafe AI の API キーが必要です。

#### 設定方法 1: VSCode 設定画面（GUI）から【推奨・最も確実】
キーバインド設定やOS環境に左右されず、最も確実に設定画面を開く手順です：
1. VSCode 画面左下にある **歯車アイコン ⚙️（管理）** をクリックし、メニューから **「設定」**（英語UIの場合は **「Settings」**）を選択します。
   *(上部メニューバーの「Code」→「設定...」や、ショートカット `Cmd+,` / `Ctrl+,` でも開けます)*
2. 設定画面上部の検索バーに **`jev`** と入力します。
3. 表示された **`Jev: Api Key`** の入力欄に、取得した TypeSafe API キーを貼り付けます（入力内容は自動保存されます）。

#### 設定方法 2: シェル環境変数で設定【設定画面を開かずに完了】
VSCode の設定画面を開かずに、ターミナルから一発で設定したい場合に最も確実です：
```bash
# macOS / Linux (zsh)
echo 'export TYPESAFE_API_KEY="取得したAPIキー"' >> ~/.zshrc
source ~/.zshrc

# bash
echo 'export TYPESAFE_API_KEY="取得したAPIキー"' >> ~/.bashrc
source ~/.bashrc
```
設定後、VSCode を再起動（または `Cmd+Shift+P` -> `Developer: Reload Window`）すると自動認識されます。

#### 設定方法 3: `settings.json` に直接記述
コマンドパレット（`Cmd+Shift+P` / `Ctrl+Shift+P`）から `Preferences: Open User Settings (JSON)` を開き、以下を追記します：
```json
{
  "jev.apiKey": "your-typesafe-api-key",
  "jev.confidenceThreshold": 0.85,
  "jev.enableOnSave": true,
  "jev.enableSpeculativeGate": true
}
```

---

### 3. 動作確認とチュートリアル

1. **ステータスバーの確認**:
   VSCode 右下に `$(sparkle) Jev: Ready` が常駐していることを確認します。
2. **リアルタイム・セキュリティ診断（保存時）**:
   ファイル保存時（`Cmd+S`）、Jevが自動でコードを評価し、危険度と確信度が高い場合に波線警告を表示します。波線部分で `Cmd+.`（Quick Fix）を押すとワンクリック修正が可能です。
3. **インテリジェント・インテントディスパッチャー**:
   コードを選択して `Cmd+Shift+P` -> **`Jev: Smart Intent Dispatcher`** を実行します。Jevがミリ秒で最適な開発者意図を分類し、確率分布を表示します。
4. **選択範囲の即時診断**:
   コードを選択して `Cmd+Shift+P` -> **`Jev: Analyze Selected Code`** を実行します。

---

## 開発者向けコマンド一覧

| コマンド | 内容 |
| :--- | :--- |
| `npm install` | 依存関係のインストール |
| `npm test` | Vitest による高速単体テスト実行（13テスト全件検証） |
| `npm run build` | TypeScript コンパイル（`dist/` 出力） |
| `npm run watch` | TypeScript 差分監視コンパイル |
| `npm run package` | 配布用 VSIX パッケージ生成（警告ゼロ） |

---

## 設定項目一覧 (`settings.json`)

| キー | 型 | デフォルト値 | 説明 |
| :--- | :--- | :--- | :--- |
| `jev.apiKey` | `string` | `""` | TypeSafe AI API Key（環境変数 `TYPESAFE_API_KEY` からも自動読み込み可） |
| `jev.baseUrl` | `string` | `https://api.typesafe.ai` | TypeSafe AI API のベースURL |
| `jev.model` | `string` | `jev-latest` | 使用する Jev モデル名 |
| `jev.confidenceThreshold` | `number` | `0.85` | 診断を波線表示するための最小確信度（0.0 〜 1.0） |
| `jev.enableOnSave` | `boolean` | `true` | ファイル保存時に自動でセキュリティ診断を実行するか |
| `jev.enableSpeculativeGate` | `boolean` | `true` | 高コストなLLM呼び出しをJevで投機的にゲートするか |
