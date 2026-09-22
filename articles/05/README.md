# Vol. 5: Cyber Air Hockey Arena (Multi-Agent Real-Time Battle)

English | [日本語](#日本語)

---

## English

### Overview
**Cyber Air Hockey Arena** is a real-time, physics-driven arcade arena featuring multi-agent AI battles across **Jev (TypeSafe System One)**, **Google Gemini (Multimodal Flash)**, **Anthropic Claude (Strategic Reasoner)**, and **Human Players**.

Experience millisecond reflexes, spatial court awareness, and deep strategic defense with seamless switching across all 6 matchup configurations:
- ⚡ **Jev × Human** (Sub-50ms Reactive Agent vs Biological Reflex)
- 🤖 **Jev × Gemini** (Intuitive Flash vs Multimodal Spatial Geometry)
- 🧠 **Jev × Claude** (Intuitive Flash vs Deep Strategic Defense)
- 🌐 **Gemini × Claude** (Spatial Wide Attack vs Geometric Precision)
- 🔷 **Gemini × Human** (Multimodal AI vs Biological Reflex)
- 🔶 **Claude × Human** (Strategic Defense vs Biological Reflex)

### Key Features
1. **Multi-Agent Architecture & Personalities**:
   - **Jev (System One)**: 15–30ms latency. Pure instinctive shot-making, rapid trick banks, and lightning smash attacks.
   - **Gemini (Flash)**: 40–70ms latency. Spatial court geometry, wide-angle drives, and panoramic court control.
   - **Claude (Strategic)**: 50–80ms latency. Impenetrable defensive positioning, calculated geometric precision, and counter-attacks.
   - **Human**: Direct mouse/touch physics manipulation with swing-velocity acceleration.
2. **Unified API Key Manager**:
   - Configure TypeSafe Jev, Google Gemini, and Anthropic Claude API keys via the in-game modal.
   - Zero configuration required out of the box: runs high-speed local simulators mimicking each model's latency and personality when API keys are not provided.
3. **Spectator Mode (AI vs AI)**:
   - When pitting two AI agents against each other, both mallets operate autonomously with live dual-telemetry HUD and in-game banter.
4. **High-Precision 2D Physics Engine**:
   - **10-Substep CCD (Continuous Collision Detection)**: Solves algebraic sweep equations to eliminate puck tunneling even at >2400 px/s.
   - Full 2D rigid-body collision impulse with restitution, Coulomb friction, and rotational spin.

### Quick Start

```bash
cd articles/05/jev-air-hockey
npm install
npm test
npm run dev
```

Open `http://localhost:5174/` in your browser.

---

## 日本語

### 概要
**Cyber Air Hockey Arena** は、TypeSafe AIの超高速意思決定モデル **Jev（System One）**、Googleの **Gemini（Multimodal Flash）**、Anthropicの **Claude（Strategic Reasoner）**、そして **人間プレイヤー** が物理空間で激突する、リアルタイム・マルチエージェント対戦エアホッケーです。

以下の全6通りの対戦カードをワンクリックで自由に切り替えて対戦・観戦できます：
- ⚡ **Jev × 人間**（Sub-50msの直感推論 vs 人間の生体反射）
- 🤖 **Jev × Gemini**（直感スピード vs マルチモーダル空間認識）
- 🧠 **Jev × Claude**（直感スピード vs 幾何学的精密防御）
- 🌐 **Gemini × Claude**（広角アタック vs 鉄壁の論理防御・AI頂上決戦）
- 🔷 **Gemini × 人間**（空間把握AI vs 人間）
- 🔶 **Claude × 人間**（論理戦略AI vs 人間）

### 主な特徴
1. **マルチエージェント設計 & 思考特性**:
   - **Jev (System One)**: レイテンシ 15〜30ms。直感的なミリ秒判断、鋭角トリックバンク、急加速スマッシュ。
   - **Gemini (Flash)**: レイテンシ 40〜70ms。コート全体を俯瞰した空間認識、広角サイドアタック。
   - **Claude (Strategic)**: レイテンシ 50〜80ms。隙のない鉄壁ディフェンス、幾何学的な精密ピンポイントショット。
   - **人間 (Human)**: マウス/タッチ操作による直感操作とスイング速度加算。
2. **統合APIキーマネージャー**:
   - 画面上部の「🔑 API Keys」から、3社（Jev, Gemini, Claude）のAPIキーをいつでも設定可能。
   - APIキー未設定の場合でも、各モデルの思考・反射・心理戦セリフ特性を忠実に再現した高速シミュレーターが即座に動作。
3. **AI対AI 観戦モード (Spectator Mode)**:
   - AI同士の対戦を選択すると、双方が自律的に超高速ラリーを展開。画面上部・下部の双方でリアルタイムな思考テレメトリと煽り合いチャットが激突します。
4. **高精度物理演算エンジン (10サブステップCCD)**:
   - 2次方程式Sweep衝突判定により、時速2400px超のスマッシュでも壁やマレットを突き抜けない完全トンネリング防止。
   - 剛体反発インパルス、クーロン摩擦、回転スピン（マグヌス効果風微小カーブ）。

### クイックスタート

```bash
cd articles/05/jev-air-hockey
npm install
npm test       # 18テスト全パス
npm run dev    # 開発サーバー起動 (http://localhost:5174/)
```
