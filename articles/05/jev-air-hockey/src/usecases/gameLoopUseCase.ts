/**
 * Game Loop & Match State Orchestrator (Clean Architecture - UseCases Layer)
 *
 * 固定タイムステップで駆動する。
 *
 * エージェントが判断するのは、パックが中央線を越えて自陣へ入ってくる瞬間だけ
 * (CPU も クラウドAPI も同じ)。それ以外の場面ではゲームは止まらない。
 *
 * CPU (ローカル演算):
 *   通信しないので、中央線上で同じステップのうちに判断を終え、時間は止めない。
 *
 * クラウドAPI (waitForDecisions=true — APIのエージェントが参加している対戦・トーナメント):
 *   中央線で判断待ちの間だけシミュレーション時間を止め、解決後に全エージェント共通の
 *   decisionBudgetMs だけ一律に進める。応答に数秒かかるエージェントでも、その判断が
 *   実際に次の一打を決められるようにするため。回線速度の差が勝敗に出ないのもこの効果。
 *
 * クラウドAPI (waitForDecisions=false):
 *   投げっぱなしにして物理を実時間で進め続ける。応答が遅いほど計画の残り時間が減る。
 *
 * 試合の始まり方 (prepareMatch):
 *   作戦タイム (STRATEGY) — AI も CPU も、通信失敗時・自陣に居座る球への打ち方を決める
 *   → 全員の準備ができたらカウントダウン (COUNTDOWN) → サーブ (PLAYING)
 *   1人でも作戦を立てられなければ試合を始めない (READY に戻り、理由を表示する)。
 *   作戦なしで始めると、通信失敗の局面でそのAIは何もできず、AI対戦として成立しないため。
 */

import {
  GameMatchState,
  GameStatus,
  DEFAULT_STADIUM_CONFIG,
  StadiumConfig,
  StrategyState,
} from "../domain/gameState";
import {
  AgentType,
  AgentStats,
  AgentTelemetry,
  createEmptyStats,
} from "../domain/jevAgentTypes";
import { aimErrorDeg } from "../domain/shotPlanValidator";
import { Vec2 } from "../domain/physics";
import { PhysicsEngine, CollisionEvent } from "./physicsEngine";
import { AgentBrainUseCase } from "./agentBrainUseCase";
import { ISoundSynthesizer } from "../adapters/soundSynthesizer";
import { AgentFactory } from "../adapters/agentFactory";

/** ゴール後の待機時間 (ゲーム内時間) */
const GOAL_PAUSE_MS = 1200;

/** 作戦が揃ってからサーブまでのカウントダウン (ゲーム内時間) */
const COUNTDOWN_MS = 3000;
/**
 * 膠着 (デッドボール) 判定のしきい値。
 * ゴールポケットの隅などで物理的に本当に動けなくなった場合の最終救済であり、
 * 通常のラリー中の減速では発動しないよう、速度は「ほぼ完全停止」、
 * 継続時間は「明らかに動きがない」と言える長さに設定する。
 */
const STAGNATION_SPEED_THRESHOLD = 20;
const STAGNATION_LIMIT_SEC = 3.5;

/** 再現性のためのシード付き擬似乱数 (mulberry32) */
function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class GameLoopUseCase {
  private readonly physics: PhysicsEngine;
  private readonly config: StadiumConfig;
  private readonly sound: ISoundSynthesizer;

  private topBrain: AgentBrainUseCase;
  private bottomBrain: AgentBrainUseCase | null = null;

  private matchState: GameMatchState;
  private topStats: AgentStats;
  private bottomStats: AgentStats;

  private stagnationTimer = 0;
  private goalPauseRemainingMs = 0;
  private pendingServe: "PLAYER" | "JEV" = "PLAYER";
  private rng: () => number;
  private advancing = false;
  private maxRallies = Number.POSITIVE_INFINITY;

  /** 自動判定 (§waitForDecisions) を、トーナメントが明示的に上書きするためのフラグ */
  private fairTimingOverride: boolean | null = null;
  /** 作戦タイムの世代。作戦タイム中に別の試合が始まったら、古い結果は捨てる */
  private strategyGeneration = 0;

  private onStateChange?: (state: GameMatchState) => void;
  private onCollisionEffect?: (event: CollisionEvent) => void;

  constructor(
    physics: PhysicsEngine,
    topBrain: AgentBrainUseCase,
    sound: ISoundSynthesizer,
    config: StadiumConfig = DEFAULT_STADIUM_CONFIG,
    initialTopAgent: AgentType = AgentType.CPU,
    initialBottomAgent: AgentType = AgentType.HUMAN
  ) {
    this.physics = physics;
    this.config = config;
    this.topBrain = topBrain;
    this.sound = sound;
    this.rng = createRng(1);

    this.matchState = {
      status: GameStatus.READY,
      score: { player: 0, jev: 0, targetScore: 7 },
      rallyCount: 0,
      maxSpeedReached: 0,
      topAgent: initialTopAgent,
      bottomAgent: initialBottomAgent,
      lastScorer: null,
      matchDurationSec: 0,
      strategy: { top: "NONE", bottom: "NONE" },
      strategyError: null,
      countdownMs: 0,
    };

    this.topStats = createEmptyStats(initialTopAgent);
    this.bottomStats = createEmptyStats(initialBottomAgent);

    this.setMatchup(initialTopAgent, initialBottomAgent);
  }

  setMatchup(topAgent: AgentType, bottomAgent: AgentType): void {
    this.matchState.topAgent = topAgent;
    this.matchState.bottomAgent = bottomAgent;

    this.topBrain.setClient(AgentFactory.createClient(topAgent), topAgent);
    // 作戦に当てはまる手が無い局面を任せる CPU
    this.topBrain.setTakeoverClient(AgentFactory.createCpuTakeover("BALANCED"));

    if (bottomAgent === AgentType.HUMAN) {
      this.bottomBrain = null;
    } else {
      this.bottomBrain = new AgentBrainUseCase(
        AgentFactory.createClient(bottomAgent),
        this.config,
        "BOTTOM",
        bottomAgent
      );
      this.bottomBrain.setTakeoverClient(AgentFactory.createCpuTakeover("BALANCED"));
    }

    this.topStats = createEmptyStats(topAgent);
    this.bottomStats = createEmptyStats(bottomAgent);

    this.physics.resetPositions("PLAYER");
    this.notifyState();
  }

  setCallbacks(
    onStateChange: (state: GameMatchState) => void,
    onCollisionEffect: (event: CollisionEvent) => void
  ): void {
    this.onStateChange = onStateChange;
    this.onCollisionEffect = onCollisionEffect;
  }

  getMatchState(): GameMatchState {
    return this.matchState;
  }

  getTopBrain(): AgentBrainUseCase {
    return this.topBrain;
  }

  getBottomBrain(): AgentBrainUseCase | null {
    return this.bottomBrain;
  }

  getStats(): { top: AgentStats; bottom: AgentStats } {
    return { top: this.topStats, bottom: this.bottomStats };
  }

  /**
   * 作戦タイムを経て試合を始める。
   * 各エージェントに作戦を立てさせ、全員の準備ができたらカウントダウンに入る。
   * minStrategyMs は画面で作戦タイムを見せるための最低時間 (実時間)。
   */
  async prepareMatch(
    targetScore = 7,
    seed = 1,
    maxRallies = Number.POSITIVE_INFINITY,
    options: { minStrategyMs?: number } = {}
  ): Promise<boolean> {
    const generation = ++this.strategyGeneration;
    const started = Date.now();

    this.matchState.status = GameStatus.STRATEGY;
    this.matchState.score = { player: 0, jev: 0, targetScore };
    this.matchState.lastScorer = null;
    this.matchState.strategy = {
      top: "PENDING",
      bottom: this.bottomBrain ? "PENDING" : "NONE",
    };
    this.matchState.strategyError = null;
    const failures: string[] = [];
    this.physics.resetPositions("PLAYER");
    this.physics.getPuck().vel.set(0, 0);
    this.notifyState();

    const prepare = async (brain: AgentBrainUseCase | null, side: "TOP" | "BOTTOM") => {
      if (!brain) return;
      const telemetry = await brain.preparePlaybook({ side, config: this.config, targetScore });
      if (generation !== this.strategyGeneration) return;
      const state: StrategyState = telemetry?.playbook ? "READY" : "FAILED";
      // 作戦に当てはまる手が無い局面は、AI 自身が選んだ動作パターンの CPU に任せる
      if (telemetry?.playbook) brain.setTakeoverClient(AgentFactory.createCpuTakeover(telemetry.playbook.cpuStyle));
      if (state === "FAILED") {
        const issues = telemetry?.issues ?? [];
        const reason =
          issues.length === 0
            ? "作戦を返せないエージェントです"
            : issues.length === 1
            ? issues[0]
            : `${issues[0]} ほか ${issues.length - 1} 件`;
        failures.push(`${side === "TOP" ? this.matchState.topAgent : this.matchState.bottomAgent}: ${reason}`);
      }
      if (side === "TOP") this.matchState.strategy.top = state;
      else this.matchState.strategy.bottom = state;
      this.notifyState();
    };

    await Promise.all([prepare(this.topBrain, "TOP"), prepare(this.bottomBrain, "BOTTOM")]);

    const remaining = (options.minStrategyMs ?? 0) - (Date.now() - started);
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
    if (generation !== this.strategyGeneration) return false;

    if (failures.length > 0) {
      // 作戦の無いAIを出場させない。READY に戻して理由を出す
      this.matchState.status = GameStatus.READY;
      this.matchState.strategyError = failures.join(" / ");
      this.notifyState();
      return false;
    }

    this.startMatch(targetScore, seed, maxRallies, { countdownMs: COUNTDOWN_MS });
    return true;
  }

  startMatch(
    targetScore = 7,
    seed = 1,
    maxRallies = Number.POSITIVE_INFINITY,
    options: { countdownMs?: number } = {}
  ): void {
    this.maxRallies = maxRallies;
    this.matchState.status = GameStatus.PLAYING;
    this.matchState.score = { player: 0, jev: 0, targetScore };
    this.matchState.rallyCount = 0;
    this.matchState.maxSpeedReached = 0;
    this.matchState.matchDurationSec = 0;
    this.matchState.lastScorer = null;

    this.topStats = createEmptyStats(this.matchState.topAgent);
    this.bottomStats = createEmptyStats(this.matchState.bottomAgent);

    this.stagnationTimer = 0;
    this.goalPauseRemainingMs = 0;
    this.rng = createRng(seed);

    this.topBrain.reset();
    this.bottomBrain?.reset();

    const countdownMs = options.countdownMs ?? 0;
    if (countdownMs > 0) {
      // パックは中央に置いたまま、カウントダウンが終わってからサーブする
      this.matchState.status = GameStatus.COUNTDOWN;
      this.matchState.countdownMs = countdownMs;
      this.physics.resetPositions("PLAYER");
      this.physics.getPuck().vel.set(0, 0);
    } else {
      this.serve("PLAYER");
    }

    this.sound.playCountDown();
    this.notifyState();
  }

  /** カウントダウンを1ステップ進める。0 になったらサーブして試合開始 */
  private advanceCountdown(): void {
    const before = Math.ceil(this.matchState.countdownMs / 1000);
    this.matchState.countdownMs -= this.config.fixedDt * 1000;
    const after = Math.ceil(this.matchState.countdownMs / 1000);

    if (this.matchState.countdownMs <= 0) {
      this.matchState.countdownMs = 0;
      this.matchState.status = GameStatus.PLAYING;
      this.serve("PLAYER");
      this.sound.playCountDown();
      this.notifyState();
      return;
    }
    if (after !== before) {
      this.sound.playCountDown();
      this.notifyState();
    }
  }

  pauseMatch(): void {
    if (this.matchState.status === GameStatus.PLAYING) {
      this.matchState.status = GameStatus.PAUSED;
      this.notifyState();
    } else if (this.matchState.status === GameStatus.PAUSED) {
      this.matchState.status = GameStatus.PLAYING;
      this.notifyState();
    }
  }

  /** 作戦タイム・カウントダウン中か (開始操作を重ねて受け付けないため) */
  isStarting(): boolean {
    return this.matchState.status === GameStatus.STRATEGY || this.matchState.status === GameStatus.COUNTDOWN;
  }

  isFinished(): boolean {
    return this.matchState.status === GameStatus.GAME_OVER;
  }

  /**
   * 判断待ちで時間を止めるかを明示指定する (§waitForDecisions のコメント参照)。
   * null を渡すと対戦カードからの自動判定に戻る。
   */
  setFairTiming(enabled: boolean | null): void {
    this.fairTimingOverride = enabled;
  }

  /**
   * 判断待ちで時間を止めるか。
   *
   * トーナメントなどの公平ベンチマーク (fairTimingOverride === true) では
   * 回線速度差を排除するため時間を止めて思考予算を一括消費する。
   * 通常のライブ対戦 (fairTimingOverride !== true) では、ゲームをフリーズ・ワープ
   * させずに滑らかに動かし続けるため、裏で非同期通信を行い、
   * AI思考中もマレットは守備体制を維持しながら滑らかに物理を進める。
   */
  isWaitingForDecisions(): boolean {
    if (this.fairTimingOverride !== null) return this.fairTimingOverride;
    return (this.topBrain.usesLiveApi() || this.bottomBrain?.usesLiveApi()) ?? false;
  }

  /**
   * シミュレーションを最大 maxSteps 回の固定ステップ進める。
   * AI の判断待ちが発生した場合はそこで時計を止め、応答後に一律の思考予算だけ進める。
   */
  async advance(maxSteps: number): Promise<void> {
    if (this.advancing) return; // 再入防止 (rAF と非同期待ちの競合)
    this.advancing = true;

    try {
      for (let i = 0; i < maxSteps; i++) {
        if (this.matchState.status === GameStatus.GAME_OVER) return;

        if (this.goalPauseRemainingMs > 0) {
          this.goalPauseRemainingMs -= this.config.fixedDt * 1000;
          if (this.goalPauseRemainingMs <= 0) this.resumeAfterGoal();
          continue;
        }

        if (this.matchState.status === GameStatus.COUNTDOWN) {
          this.advanceCountdown();
          continue;
        }

        if (this.matchState.status !== GameStatus.PLAYING) return;

        const decided = await this.resolveDecisions();
        if (decided) continue; // 思考予算分の時間は resolveDecisions 内で消費済み

        this.stepOnce();
      }
    } finally {
      this.advancing = false;
    }
  }

  /**
   * 判断が必要なエージェントがいれば問い合わせる。
   *   CPU        — その場で解決を待つ。時間は止めず、同じティックで物理を進める
   *   クラウドAPI — waitForDecisions=true なら解決を待って共通の思考予算ぶん時間を進める
   *                (戻り値 true = このティックは思考予算の消費で使い切った)。
   *                false なら投げっぱなしにし、物理は同じティックで進み続ける。
   */
  private async resolveDecisions(): Promise<boolean> {
    const puck = this.physics.getPuck();
    const bottomMallet = this.physics.getPlayerMallet();
    const topMallet = this.physics.getJevMallet();

    const top = this.topBrain.observe(puck);
    this.applyApproachResult(this.topStats, top.approachEnded);

    const bottom = this.bottomBrain?.observe(puck);
    if (bottom) this.applyApproachResult(this.bottomStats, bottom.approachEnded);

    if (!top.needsDecision && !bottom?.needsDecision) return false;

    const localRequests: Array<Promise<void>> = [];
    const liveRequests: Array<Promise<void>> = [];
    const queueFor = (brain: AgentBrainUseCase) => (brain.usesLiveApi() ? liveRequests : localRequests);

    if (top.needsDecision) {
      this.topStats.decisions++;
      queueFor(this.topBrain).push(
        this.topBrain
          .requestDecision(
            puck,
            topMallet,
            bottomMallet,
            this.matchState.score.jev,
            this.matchState.score.player
          )
          .then((t) => this.recordDecision(this.topStats, t, this.topBrain.getAgentType()))
      );
    }

    if (bottom?.needsDecision && this.bottomBrain) {
      const brain = this.bottomBrain;
      this.bottomStats.decisions++;
      queueFor(brain).push(
        brain
          .requestDecision(
            puck,
            bottomMallet,
            topMallet,
            this.matchState.score.player,
            this.matchState.score.jev
          )
          .then((t) => this.recordDecision(this.bottomStats, t, brain.getAgentType()))
      );
    }

    // CPU は通信しないので即座に返る。中央線上で判断を確定させ、時間は止めない
    await Promise.all(localRequests);

    if (liveRequests.length === 0) return false;

    if (!this.isWaitingForDecisions()) {
      // 裏で進行させるだけ。呼び出し元は待たずに同じティックで物理を進める。
      // requestDecision() は最初の await 前に awaitingDecision を同期的に立てる
      // ため、次の observe() で二重に発火することはない。
      void Promise.all(liveRequests);
      return false;
    }

    await Promise.all(liveRequests);

    // 実測レイテンシに関わらず、消費するゲーム内時間は常に同じ
    this.consumeThinkingBudget();
    return true;
  }

  /** 思考予算ぶんだけ物理を進める。この間は新たな判断を受け付けない */
  private consumeThinkingBudget(): void {
    const steps = Math.max(1, Math.round(this.config.decisionBudgetMs / 1000 / this.config.fixedDt));
    for (let i = 0; i < steps; i++) {
      if (this.matchState.status !== GameStatus.PLAYING) return;
      this.stepOnce();
    }
  }

  /** 固定タイムステップ1回ぶんの前進 */
  private stepOnce(): void {
    const dt = this.config.fixedDt;
    const puck = this.physics.getPuck();

    this.matchState.matchDurationSec += dt;

    this.topBrain.stepServo(dt, this.physics.getJevMallet(), puck, this.physics.getPlayerMallet().pos);
    this.bottomBrain?.stepServo(dt, this.physics.getPlayerMallet(), puck, this.physics.getJevMallet().pos);

    const goal = this.physics.step(dt, (event) => this.handleCollision(event));

    this.collectPredictionErrors(this.topStats, this.topBrain);
    if (this.bottomBrain) this.collectPredictionErrors(this.bottomStats, this.bottomBrain);
    this.topStats.cpuTakeovers += this.topBrain.takeTakeoverEvents();
    if (this.bottomBrain) this.bottomStats.cpuTakeovers += this.bottomBrain.takeTakeoverEvents();

    const speed = puck.vel.mag();
    if (speed > this.matchState.maxSpeedReached) {
      this.matchState.maxSpeedReached = Math.round(speed);
    }

    if (speed < STAGNATION_SPEED_THRESHOLD) {
      this.stagnationTimer += dt;
      if (this.stagnationTimer > STAGNATION_LIMIT_SEC) {
        this.stagnationTimer = 0;
        // デッドボール再開。通常のサーブと同じ演出 (カウントダウン音) にして、
        // 「誰にも触れられていないのに勝手に動いた」という見え方を避ける
        puck.vel.set((this.rng() - 0.5) * 160, this.rng() > 0.5 ? 220 : -220);
        this.sound.playCountDown();
      }
    } else {
      this.stagnationTimer = 0;
    }

    if (goal) {
      this.stagnationTimer = 0;
      this.handleGoal(goal);
      return;
    }

    // ラリー数の上限に達したら打ち切る (API課金の上限として機能する)
    if (this.matchState.rallyCount >= this.maxRallies) {
      this.finishMatch();
    }
  }

  /** 中央線で予告した接触位置と、実際のパック位置との差 (予測精度の指標) */
  private collectPredictionErrors(stats: AgentStats, brain: AgentBrainUseCase): void {
    for (const errorPx of brain.takePredictionErrors()) {
      stats.predictionErrorSumPx += errorPx;
      stats.predictionSamples++;
    }
  }

  private recordDecision(stats: AgentStats, telemetry: AgentTelemetry | null, _agent: AgentType): void {
    if (!telemetry) return;

    if (telemetry.isLiveApi) stats.apiCalls++;
    stats.latencySumMs += telemetry.rawLatencyMs;
    stats.latencySamples++;

    switch (telemetry.status) {
      case "CLAMPED":
        stats.clamped++;
        break;
      case "INVALID":
        stats.invalid++;
        break;
      case "ERROR":
        stats.errors++;
        break;
      case "TIMEOUT":
        stats.timeouts++;
        break;
    }
  }

  private applyApproachResult(stats: AgentStats, result: "SAVE" | "WHIFF" | null): void {
    if (result === "SAVE") stats.saves++;
    else if (result === "WHIFF") stats.whiffs++;
  }

  private handleCollision(event: CollisionEvent): void {
    this.onCollisionEffect?.(event);

    const normPower = Math.min(1.0, event.impactSpeed / 1800);

    if (event.type === "PUCK_WALL") {
      this.sound.playWallBounce();
      // 軌道が変わったので、接近中のエージェントに再判断の機会を与える
      this.topBrain.notifyWallBounce();
      this.bottomBrain?.notifyWallBounce();
      return;
    }

    this.matchState.rallyCount++;
    this.sound[normPower > 0.75 ? "playSmashHit" : "playHitPuck"](normPower);

    const isTop = event.type === "PUCK_MALLET_JEV";
    const brain = isTop ? this.topBrain : this.bottomBrain;
    if (!brain) return;

    // 狙いの評価は recordContact より先に行う。recordContact は実行中の一撃を
    // 破棄するので、順序を逆にすると「振り抜いた接触」が1件も記録されなくなる
    this.recordAimError(isTop ? this.topStats : this.bottomStats, brain, event.pos);
    brain.recordContact(this.physics.getPuck().pos);
  }

  /**
   * 宣言した狙いと実際の飛翔方向の差を記録する (物理理解度の指標)。
   *
   * 意図した一撃を振り抜けた接触だけを数える。構えが間に合わずに当てられた
   * ブロックは、そもそも方向を選べないので指標に含めない (全エージェントに
   * 同じ基準で適用される)。
   */
  private recordAimError(stats: AgentStats, brain: AgentBrainUseCase, contactPos: Vec2): void {
    const plan = brain.getPlan();
    if (!plan || !brain.isExecutingStrike()) return;

    const error = aimErrorDeg(plan, contactPos, this.physics.getPuck().vel);
    if (error === null) return;

    stats.aimErrorSumDeg += error;
    stats.aimErrorSamples++;
  }

  private handleGoal(goal: "GOAL_PLAYER" | "GOAL_JEV"): void {
    this.matchState.status = GameStatus.GOAL_SCORED;
    this.sound.playGoal();

    // 失点した側は、その局面でパックを止められなかったことになる
    const concededBrain = goal === "GOAL_PLAYER" ? this.topBrain : this.bottomBrain;
    const concededStats = goal === "GOAL_PLAYER" ? this.topStats : this.bottomStats;
    this.applyApproachResult(concededStats, concededBrain?.finalizeApproach() ?? null);

    if (goal === "GOAL_PLAYER") {
      this.matchState.score.player++;
      this.matchState.lastScorer = "BOTTOM";
      this.bottomStats.goalsFor++;
      this.topStats.goalsAgainst++;
    } else {
      this.matchState.score.jev++;
      this.matchState.lastScorer = "TOP";
      this.topStats.goalsFor++;
      this.bottomStats.goalsAgainst++;
    }

    this.notifyState();

    if (
      this.matchState.score.player >= this.matchState.score.targetScore ||
      this.matchState.score.jev >= this.matchState.score.targetScore
    ) {
      this.finishMatch();
      return;
    }

    this.pendingServe = goal === "GOAL_PLAYER" ? "JEV" : "PLAYER";
    this.goalPauseRemainingMs = GOAL_PAUSE_MS;
  }

  private finishMatch(): void {
    this.matchState.status = GameStatus.GAME_OVER;

    this.topStats.matches++;
    this.bottomStats.matches++;

    // ラリー数上限で打ち切られた場合は引き分けがありうる
    const diff = this.matchState.score.jev - this.matchState.score.player;
    if (diff === 0) {
      this.topStats.draws++;
      this.bottomStats.draws++;
    } else {
      const topWon = diff > 0;
      this.topStats[topWon ? "wins" : "losses"]++;
      this.bottomStats[topWon ? "losses" : "wins"]++;
    }

    this.notifyState();
  }

  private resumeAfterGoal(): void {
    this.goalPauseRemainingMs = 0;
    this.serve(this.pendingServe);
    this.matchState.status = GameStatus.PLAYING;
    this.sound.playCountDown();
    this.notifyState();
  }

  private serve(side: "PLAYER" | "JEV"): void {
    const isHuman = this.matchState.bottomAgent === AgentType.HUMAN;
    this.physics.resetPositions(side, side === "PLAYER" && isHuman);
    const puck = this.physics.getPuck();
    if (side === "PLAYER" && isHuman) {
      // 人間プレイヤーサーブ時は手元に静止させ、プレイヤー自身が第1打を打てるようにする
      puck.vel.set(0, 0);
    } else {
      // CPU/AIサーブ時は前進速度を付与してサーブ
      puck.vel.set((this.rng() - 0.5) * 120, side === "PLAYER" ? -240 : 240);
    }

    this.topBrain.reset();
    this.bottomBrain?.reset();
  }

  private notifyState(): void {
    this.onStateChange?.({ ...this.matchState });
  }
}
