# ⚔️ JEV RETRO DUNGEON ⚔️

[English](#english) | [日本語](#日本語)

---

<a name="english"></a>
## English

### 📖 Overview
**JEV RETRO DUNGEON** is a classic retro roguelike RPG powered by the **Jev System One AI Engine**. It combines retro pixel-art aesthetics (NES-style chiptune audio with SNES-class sprites) with modern AI-driven procedural generation, featuring **221,184,000 generative DNA monsters**, real-time **Web Audio API chiptune BGM composition**, full **equipment and inventory management**, and dynamic **8-language localization**.

All game balance decisions—dungeon layout parameters, monster genetic recombination, encounter timings, dynamic combat tactics, equipment awakening, and monster collectible cards—are directed in real time by Jev System One.

---

### ✨ Key Features

1. **🗺️ Endless Dungeon & Jev AI Game Director**
   - Procedural dungeon generation for every floor.
   - Starting position is always safely calibrated at the top-left (`x: 2, y: 2`).
   - Jev evaluates floor danger score, enemy density, and item drops based on the player's level and health.

2. **👾 221 Million Generative DNA Monsters**
   - Monsters are composed of 8 gene slots (Body 12 / Eyes 12 / Mouth 10 / Horns 12 / Wings 10 / Tail 10 / Aura 8 / Palette 16), giving exactly 221,184,000 unique visual and statistical combinations. Every combination renders a distinct sprite.
   - Real-time generative pixel rendering on HTML5 Canvas without static sprite sheets.

3. **⚔️ Classic Turn-Based Command Battle**
   - Pure classic RPG command interface: **Fight**, **Spells** (*Fire*, *Heal*, *Thunder*), **Items** (*Medicinal Herb*), and **Run**.
   - Reliable encounter system: walking steps are tracked with guaranteed encounter ceilings every 3–7 steps.

4. **🛡️ Equipment & Item Inventory System**
   - Open the equipment menu anytime with `[E]`.
   - Equip weapons, shields, armor, and accessories discovered in treasure chests to immediately boost ATK, DEF, and SPD.
   - Use medicinal herbs on the field (`[H]` key or inside inventory) or in combat to restore HP.

5. **🎵 Real-time Dynamic Chiptune BGM Composer**
   - Pure Web Audio API chiptune synthesis using square waves, triangle waves, and white noise.
   - For every descending floor, Jev AI composes a unique ambient musical track matching the floor's elemental atmosphere.

6. **🃏 Slaying Victory NFT-Style Collectible Cards**
   - Defeating monsters triggers Jev to generate a unique commemorative card with title, danger score, DNA hash, and flavor lore.
   - One-click PNG image export and sharing to X (Twitter).

7. **🌐 Complete 8-Language Localization (i18n)**
   - Fully localized across: **Japanese (ja)**, **English (en)**, **Français (fr)**, **Italiano (it)**, **Deutsch (de)**, **中文 (zh)**, **한국어 (ko)**, and **हिन्दी (hi)**.
   - Fixed-size pixel UI layout: window frames and side panels remain rock-solid without shifting or resizing across all languages.

---

### 🎮 Controls

| Key | Action |
| :--- | :--- |
| **WASD / Arrow Keys** | Move Hero in Dungeon / Navigate Command Menu |
| **SPACE / ENTER / Z** | Confirm / Inspect Chest / Advance Dialog |
| **ESC / X / Backspace** | Cancel / Close Menu |
| **E** | Open / Close Equipment & Inventory Screen |
| **H** | Use Medicinal Herb (Restore 35 HP) |
| **B** | Instant Battle Encounter (Debug & Demo shortcut) |

---

### 🚀 Quick Start

```bash
# Navigate to the project directory
cd articles/03/jev-retro-dungeon

# Install dependencies
npm install

# Start local development server (Vite)
npm run dev

# Run unit tests (Vitest)
npm test

# Build for production
npm run build
```

Open your browser at `http://localhost:3000/`.

---

### 🏗️ Clean Architecture

The codebase strictly follows Clean Architecture principles:

```
src/
├── domain/            # Core entities, models, DNA genes, equipment, and i18n dictionaries
│   ├── constants.ts
│   ├── dnaModels.ts
│   ├── equipmentModels.ts
│   ├── i18nTypes.ts
│   ├── jevTypes.ts
│   └── models.ts
├── usecases/          # Pure application business rules & Jev AI decision pipelines
│   ├── battleUseCase.ts
│   ├── bgmComposerUseCase.ts
│   ├── cardGeneratorUseCase.ts
│   ├── gameDirectorUseCase.ts
│   └── generativeMonsterUseCase.ts
├── adapters/          # Jev API Client, Fallback Simulator & Audio Synthesizer
│   ├── jevClient.ts
│   └── soundEngine.ts
└── presentation/      # HTML5 Canvas Rendering, DOM UI, Input Handling, Audio Engine
    ├── audioSynthesizer.ts
    ├── canvasRenderer.ts
    ├── cardRenderer.ts
    ├── gameLoop.ts
    ├── generativeRenderer.ts
    ├── i18nManager.ts
    └── inputHandler.ts
```

---

### 📄 License

This software and sample code is released under the **[MIT License](./LICENSE)**.

Free for both personal and commercial use, modification, and distribution (subject to the inclusion of the original copyright and permission notice).

Full text: [`LICENSE`](./LICENSE)

Copyright (c) 2026 Masashi Yamashita.

---
---

<a name="日本語"></a>
## 日本語

### 📖 概要
**JEV RETRO DUNGEON（Jev レトロダンジョン）** は、**TypeSafe Jev System One AI エンジン** をフル活用した本格的王道レトロローグライクRPGです。ファミコン由来のチップチューンと、スーファミ級の多階調ドット絵と、現代AIによる超高速意思決定を融合させ、**2.2億通り（221,184,000通り）のジェネラティブDNAモンスター**、**Web Audio APIによるフロア別リアルタイム作曲BGM**、**装備の収集・着脱システム**、そして**世界8言語の完全多言語対応**を実現しています。

ダンジョンマップの生成から、モンスターのDNA配合、エンカウント歩数判定、戦闘時の敵AI戦術、武器の二つ名覚醒、討伐NFTカードの自動生成に至るまで、すべてのゲームバランスを Jev System One がミリ秒単位でリアルタイムにディレクションします。

---

### ✨ 主な機能・特徴

1. **🗺️ 終わりなきダンジョン探索 ＆ Jev AI ゲームディレクター**
   - 階段（青タイル）を降りるたびに新たなフロアを自動生成。
   - 階段降下時の勇者スタート位置は必ず左上の安全地帯（`x: 2, y: 2`）に配置。
   - プレイヤーのレベルや現在HPをJevがリアルタイムに分析し、フロアの危険度や宝箱のドロップ率を自動調整。

2. **👾 2.2億通りのジェネラティブDNAモンスター**
   - 種族（スライム、ビースト、ドラゴン、ゴーレム、キメラ等）、属性（通常、紅蓮、氷結、虚無、黄金）、カラーパレット、二つ名の4つの遺伝子コード（DNA）をJevが配合。
   - 静止画スプライトを使わず、HTML5 Canvas上にプロシージャルに巨大ドット絵を描画。

3. **⚔️ 王道ターン制コマンドバトル**
   - レトロRPGの基本である「たたかう」「じゅもん（ファイア / ヒール / サンダー）」「どうぐ（やくそう）」「にげる」の4大コマンド。
   - 3〜7歩歩くと確実にエンカウントするステップカウンター＆天井システムを搭載し、快適なバトルテンポを実現。

4. **🛡️ 装備の収集・着脱 ＆ 道具使用システム**
   - `[E]` キーでいつでも「もちもの＆そうび」画面を開閉可能。
   - 宝箱から入手した武器・盾・鎧・装飾品を自由に付け替え、攻撃力（ATK）や守備力（DEF）を即時強化。
   - ダンジョン探索中（`[H]` キー）でも、インベントリ画面でも、戦闘中でも、やくそうを使ってHPを回復可能。

5. **🎵 Web Audio APIによる8bit Chiptuneリアルタイム自動作曲**
   - 矩形波・三角波・ノイズジェネレーターによるピュアレトロ音源。
   - フロアの属性（溶岩、氷結、虚無など）に合わせて、Jevがスケール・テンポ・アルペジオ・ベースラインを即興で作曲。

6. **🃏 モンスター討伐NFTカード生成・保存・共有**
   - モンスター撃破時に、戦闘データ（死闘度、DNAハッシュ、二つ名、図鑑説明文）を刻んだ記念カードを自動生成。
   - ワンクリックでPNG画像ダウンロード保存、およびX（Twitter）への共有が可能。

7. **🌐 8言語完全ローカライズ ＆ 固定枠UIレイアウト**
   - 対応言語：**日本語**、**英語**、**フランス語**、**イタリア語**、**ドイツ語**、**中国語**、**韓国語**、**ヒンディー語**。
   - 言語を切り替えてもウィンドウ枠やサイドパネルのサイズが一切ブレない固定ピクセル設計。
   - 高解像度ディスプレイでも潰れずくっきり読める、レトロフォント（DotGothic16）とシャドウ縁取りを採用。

---

### 🎮 操作方法

| キー | 動作 |
| :--- | :--- |
| **WASD / 方向キー** | ダンジョン内の移動 / コマンド・アイテム選択 |
| **SPACE / ENTER / Z** | 決定 / 宝箱を調べる / メッセージ送り |
| **ESC / X / Backspace** | キャンセル / メニューを閉じる |
| **E** | 「もちもの＆そうび」画面の開閉（装備着脱） |
| **H** | 道具（やくそう）を使ってHPを35回復 |
| **B** | 即時エンカウント（戦闘テスト・体験用ショートカット） |

---

### 🚀 クイックスタート

```bash
# プロジェクトディレクトリへ移動
cd articles/03/jev-retro-dungeon

# 依存パッケージをインストール
npm install

# 開発用ローカルサーバーの起動 (Vite)
npm run dev

# ユニットテストの実行 (Vitest)
npm test

# 本番用ビルド (TypeScript型チェック + Viteバンドル)
npm run build
```

ブラウザで `http://localhost:3000/` を開くとゲームが開始されます。

---

### 🏗️ クリーンアーキテクチャ設計

本プロジェクトは保守性とテスト容易性を追求したクリーンアーキテクチャで設計されています：

- **Domain Layer (`src/domain/`)**: エンティティ（Hero, Monster, DungeonFloor）、DNAモデル、装備スロット、多言語辞書（i18n）、定数。
- **Use Case Layer (`src/usecases/`)**: バトル進行、Jevによるマップ・エンカウント采配、モンスターDNA配合、TCGカード生成、BGM作曲ユースケース。
- **Adapter Layer (`src/adapters/`)**: Jev APIクライアント、通信フォールバック用シミュレータ、8bitサウンドエンジン。
- **Presentation Layer (`src/presentation/`)**: Canvas描画（ダンジョン・バトル・カード・装備画面）、ゲームループ、入力管理、多言語マネージャー。

---

### 📄 ライセンス

本ソフトウェアおよびサンプルコードは **[MIT ライセンス](./LICENSE)** のもとで公開されています。

商用・非商用を問わず、複製・改変・再配布・自作プロジェクトへの組み込みなど、自由にご利用いただけます（著作権表示の保持が必要です）。

全文: [`LICENSE`](./LICENSE)

Copyright (c) 2026 Masashi Yamashita.
