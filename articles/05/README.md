# Vol. 5: Cyber Air Hockey Arena (Multi-Agent Real-Time Battle)

English | [日本語](#日本語)

---

## English

### Overview
**Cyber Air Hockey Arena** is a real-time, physics-driven arcade arena featuring multi-agent AI battles across **Jev (TypeSafe System One)**, **Google Gemini**, **Anthropic Claude**, and **Human Players**.

Every agent — cloud LLM or local simulator — is asked the exact same *structured-output questions* through a shared protocol, so match results reflect prediction and tactical quality rather than API plumbing differences. The arena supports live 1‑on‑1 matches (real-time, non-blocking AI thinking) as well as a full **round-robin Tournament Mode** with fairness-normalized decision timing and a per-agent stats leaderboard.

- ⚡ **Jev × Human** — Sub-30ms reactive agent vs. biological reflex
- 🤖 **Jev × Gemini** — Reactive speed vs. spatial court geometry
- 🧠 **Jev × Claude** — Reactive speed vs. deep strategic reasoning
- 🌐 **Gemini × Claude** — AI championship match
- 🔷 **Gemini × Human**, 🔶 **Claude × Human** — AI vs. biological reflex

### Tournament Results (Preview)

A round-robin tournament (CPU / Jev / Gemini / Claude, 1 match per pairing) has already been run. Headline: **Gemini took the AI-division win on decision quality, while Jev was by far the fastest thinker** — averaging 299ms per decision vs. Claude's 1,246ms and Gemini's ~13,005ms, despite finishing last on the scoreboard. Full standings, per-agent stats, and the speed breakdown are in the write-up: **[05_jev_air_hockey_agent.md](./05_jev_air_hockey_agent.md)** (Japanese).

### Key Features

1. **A Shared "Choice-Question" Protocol for Every Agent**
   Instead of free-form prompting, every agent answers the *same* set of structured questions per shot — *when/where to make contact* (sampled along the predicted puck path), *where to aim*, *which approach path to take*, *how fast to move*, and *how hard to swing*. Answers are plain string enums (not open-ended numbers), which keeps structured-output schemas reliable across Claude, Gemini, and Jev. A shared guardrail (`shotPlanValidator`) rejects or clamps out-of-range answers and records every correction — nothing is silently "fixed and forgotten."

2. **Pre-Match Strategy Time (Playbook)**
   Before a match starts, each agent — including the CPU — is asked to pre-commit a full playbook covering 20 puck situations (10 "incoming" + 10 "lingering") plus a chosen tactical personality (`BALANCED`, `ATTACK_FIRST`, `BANK_SHOOTER`, `SAFE_CLEAR`, …). This playbook is the fallback whenever a live decision can't be made in time, so the game never freezes or plays a "blank" move — and a match won't start at all unless every participant can produce a complete, valid playbook.

3. **Tactics Engineered Against Stalemates**
   Shot candidates (7 direct angles + 6 bank-shot mirrors + a defensive clear) are scored by literally re-simulating the resulting trajectory, rewarding shots that are hard to save, force the opponent's mallet to travel further, and keep the puck pinned in the opponent's half — not just raw shot speed. This directly fixes a measured failure mode where two identical agents fell into 400+ second stalemates trading maximum-power straight shots.

4. **Fairness-First Decision Budget**
   In Tournament Mode, the simulation clock pauses while a cloud agent is thinking and always resumes by advancing exactly one fixed "decision budget" of simulated time — regardless of whether the real API call took 5ms or 8s. This makes tournament outcomes a measure of *decision quality*, not network latency. In live 1-on-1 play, the clock keeps running in real time instead, so watching a match never looks like it's warping.

5. **Servo-Controlled Mallet Execution**
   Tactical decisions and physical mallet movement are fully separated: once a shot plan is committed, a dedicated servo controller drives the mallet with feed-forward + proportional tracking, arrival-style deceleration, and hard anti-oscillation rules (no instantaneous velocity flips, no drifting back toward a puck it already passed). This keeps every AI's movement visually smooth and readable, even under LLM latency.

6. **Puck Prediction & Interception Solver**
   A forward physics simulator predicts the puck's path (bounces, friction, goal detection) using the exact same math as the live physics engine, and an iterative contact-normal solver figures out the mallet position and swing that will actually send the puck toward the declared aim point — because outgoing direction is driven by contact geometry, not just swing direction.

7. **Tournament Mode**
   Full round-robin scheduling across any combination of agents, side-swapped every other match for fairness, with a live leaderboard tracking win/loss/draw record, goal difference, save rate, prediction error, aim error, CPU-takeover count, and mean latency per agent.

8. **Unified API Key Manager**
   Configure Jev, Gemini, and Claude API keys via the in-game modal, with live key verification and actionable error messages. No key configured for an agent simply disables it in the UI — there's no silent fallback to a simulator mid-match.

9. **High-Precision 2D Physics Engine**
   10-substep continuous collision detection (CCD) solving the exact sweep equation between moving circles, eliminating puck tunneling even above 2400 px/s, plus full rigid-body impulse resolution with restitution, friction, and swing-velocity transfer.

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
**Cyber Air Hockey Arena** は、TypeSafe AIの直感型意思決定モデル **Jev（System One）**、Googleの **Gemini**、Anthropicの **Claude**、そして **人間プレイヤー** が物理空間で激突する、リアルタイム・マルチエージェント対戦エアホッケーです。

クラウドLLMかローカルシミュレータかを問わず、すべてのエージェントは **同一の構造化質問プロトコル** に答える形で意思決定します。これにより、対戦結果がAPIの実装差ではなく「予測精度」と「戦術の質」の差として現れるように設計されています。人間とのリアルタイム対戦に加え、レイテンシの影響を排除した **総当たりトーナメントモード** と、エージェントごとの詳細な成績表も備えています。

- ⚡ **Jev × 人間**（Sub-30msの直感反射 vs 人間の生体反射）
- 🤖 **Jev × Gemini**（直感スピード vs 空間認識）
- 🧠 **Jev × Claude**（直感スピード vs 深い戦略推論）
- 🌐 **Gemini × Claude**（AI頂上決戦）
- 🔷 **Gemini × 人間**、🔶 **Claude × 人間**（AI vs 人間）

### トーナメント結果（ダイジェスト）

CPU・Jev・Gemini・Claudeによる総当たり戦（各カード1試合）をすでに実施済みです。結果は **判断の質ではGeminiがAI部門で優勝した一方、JEVは平均299ms／回という圧倒的な速さ** を記録（Claudeの1,246ms、Geminiの約13,005msに対し）——順位こそ最下位でしたが、レイテンシではAI勢の中でずば抜けていました。全順位表・エージェント別スタッツ・速度の考察は本編の記事をご覧ください：**[05_jev_air_hockey_agent.md](./05_jev_air_hockey_agent.md)**。

### 主な特徴

1. **全エージェント共通の「選択式質問」プロトコル**
   自由記述のプロンプトではなく、どのエージェントも1打ごとに同じ質問セットに答えます——予測されたパック軌道上の「いつ・どこで当てるか」、「どこへ狙うか」、「どの経路で構えに入るか」、「移動速度」、「振り抜きの強さ」。回答はすべて文字列の列挙型（enum）にすることで、Claude・Gemini・Jevいずれの構造化出力でも安定して機能します。共通のガードレール（`shotPlanValidator`）が範囲外の回答を却下またはクランプし、すべての補正を記録として残します——「こっそり直して忘れる」ことはありません。

2. **試合前の「作戦タイム」（プレイブック）**
   試合開始前に、CPUを含む全エージェントが20通りのパック状況（「向かってくる」10種＋「留まっている」10種）と、戦術的な性格（`BALANCED`、`ATTACK_FIRST`、`BANK_SHOOTER`、`SAFE_CLEAR` など）を含む完全なプレイブックを事前に宣言させられます。これはライブ判断が間に合わない場合のフォールバックとして機能し、ゲームが固まったり「何もしない」手を打ったりすることを防ぎます。全参加者が有効なプレイブックを完成できない限り、試合そのものが開始されません。

3. **膠着状態を防ぐための戦術設計**
   候補ショット（直接7方向＋バンクショット6方向＋守備的クリア）は、実際に着弾後の軌道を再シミュレーションしてスコアリングされます。単なる速度ではなく、「セーブされにくいか」「相手マレットをどれだけ動かすか」「パックを相手コートに留められるか」を評価します。これは、同一エージェント同士が最大出力の直線ショットを打ち合い続け、400秒を超える膠着状態に陥った実測の不具合を直接修正するための設計です。

4. **公平性を最優先した思考バジェット**
   トーナメントモードでは、クラウドエージェントが思考している間シミュレーション時計を一時停止し、実際のAPI応答が5msでも8秒でも、常に同じ固定「思考バジェット」分だけ時間を進めます。これにより対戦結果は通信速度ではなく「判断の質」を反映します。人間との1対1対戦では逆に時計を止めず実時間で進行するため、観戦していて時間が歪むような違和感がありません。

5. **サーボ制御によるマレット駆動**
   戦術判断と物理的なマレット駆動を完全に分離しています。ショット計画が確定すると、専用のサーボコントローラがフィードフォワード＋比例制御・到達型減速・急な反転を禁止する強い反発振動対策でマレットを駆動します。これにより、LLMのレイテンシがあってもAIの動きは常に滑らかで見やすいものになります。

6. **パック予測 & 迎撃ソルバー**
   実際の物理エンジンと全く同じ計算式でパックの軌道（反射・摩擦・ゴール判定）を先読みし、反復的な接触法線ソルバーが「宣言した狙い通りにパックを送り出すための」マレット位置と振り抜き方向を算出します。パックの飛び出す方向は振り抜きそのものではなく接触の幾何学で決まるためです。

7. **トーナメントモード**
   任意の組み合わせによる総当たり戦を自動編成し、公平性のため対戦ごとに上下のコートを入れ替えます。勝敗・得失点差・セーブ率・予測誤差・照準誤差・CPU代打回数・平均レイテンシをエージェントごとにリアルタイム集計するリーダーボードを備えます。

8. **統合APIキーマネージャー**
   画面上部の「🔑 API Keys」から、Jev・Gemini・Claudeの3社のAPIキーをいつでも設定可能。設定前にライブ検証を行い、具体的なエラー原因を提示します。キー未設定のエージェントはUI上で単純に選択不可になるだけで、試合中にシミュレータへこっそり切り替わることはありません。

9. **高精度物理演算エンジン（10サブステップCCD）**
   移動する円同士の厳密なスイープ方程式を解く連続衝突判定（CCD）により、時速2400px超のスマッシュでも壁やマレットを突き抜けない完全トンネリング防止を実現。剛体反発インパルス、クーロン摩擦、スイング速度の伝達を含むフル物理演算。

### クイックスタート

```bash
cd articles/05/jev-air-hockey
npm install
npm test       # Vitestによるテストスイートを実行
npm run dev    # 開発サーバー起動 (http://localhost:5174/)
```
