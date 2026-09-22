/**
 * Game Loop & Match State Orchestrator (Clean Architecture - UseCases Layer)
 *
 * 実時間ではなく「シミュレーション時間」で駆動する。AIの判断を待つ間、時計は止まる。
 * 応答が返ったら、実測レイテンシに関わらず全エージェント共通の decisionBudgetMs だけ
 * 時間を進める。これにより回線速度の差が勝敗から切り離され、比較が成立する。
 */

import {
  GameMatchState,
  GameStatus,
  DEFAULT_STADIUM_CONFIG,
  StadiumConfig,
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
/** 膠着からの自動サーブまでの時間 (ゲーム内時間) */
const STAGNATION_LIMIT_SEC = 2.0;

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
    };

    this.topStats = createEmptyStats(initialTopAgent);
    this.bottomStats = createEmptyStats(initialBottomAgent);

    this.setMatchup(initialTopAgent, initialBottomAgent);
  }

  setMatchup(topAgent: AgentType, bottomAgent: AgentType): void {
    this.matchState.topAgent = topAgent;
    this.matchState.bottomAgent = bottomAgent;

    this.topBrain.setClient(AgentFactory.createClient(topAgent), topAgent);

    if (bottomAgent === AgentType.HUMAN) {
      this.bottomBrain = null;
    } else {
      this.bottomBrain = new AgentBrainUseCase(
        AgentFactory.createClient(bottomAgent),
        this.config,
        "BOTTOM",
        bottomAgent
      );
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

  startMatch(targetScore = 7, seed = 1, maxRallies = Number.POSITIVE_INFINITY): void {
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
    this.serve("PLAYER");

    this.sound.playCountDown();
    this.notifyState();
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

  isFinished(): boolean {
    return this.matchState.status === GameStatus.GAME_OVER;
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

        if (this.matchState.status !== GameStatus.PLAYING) return;

        const decided = await this.resolveDecisions();
        if (decided) continue; // 思考予算分の時間は resolveDecisions 内で消費済み

        this.stepOnce();
      }
    } finally {
      this.advancing = false;
    }
  }

  /** 判断が必要なエージェントがいれば問い合わせ、共通の思考予算を消費する */
  private async resolveDecisions(): Promise<boolean> {
    const puck = this.physics.getPuck();
    const bottomMallet = this.physics.getPlayerMallet();
    const topMallet = this.physics.getJevMallet();

    const top = this.topBrain.observe(puck);
    this.applyApproachResult(this.topStats, top.approachEnded);

    const bottom = this.bottomBrain?.observe(puck);
    if (bottom) this.applyApproachResult(this.bottomStats, bottom.approachEnded);

    if (!top.needsDecision && !bottom?.needsDecision) return false;

    const requests: Array<Promise<void>> = [];

    if (top.needsDecision) {
      this.topStats.decisions++;
      requests.push(
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
      requests.push(
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

    await Promise.all(requests);

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

    this.topBrain.stepServo(dt, this.physics.getJevMallet(), puck);
    this.bottomBrain?.stepServo(dt, this.physics.getPlayerMallet(), puck);

    const goal = this.physics.step(dt, (event) => this.handleCollision(event));

    const speed = puck.vel.mag();
    if (speed > this.matchState.maxSpeedReached) {
      this.matchState.maxSpeedReached = Math.round(speed);
    }

    if (speed < 45) {
      this.stagnationTimer += dt;
      if (this.stagnationTimer > STAGNATION_LIMIT_SEC) {
        this.stagnationTimer = 0;
        puck.vel.set((this.rng() - 0.5) * 160, this.rng() > 0.5 ? 260 : -260);
        this.sound.playHitPuck(0.4);
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
      return;
    }

    this.matchState.rallyCount++;
    this.sound[normPower > 0.75 ? "playSmashHit" : "playHitPuck"](normPower);

    const isTop = event.type === "PUCK_MALLET_JEV";
    const brain = isTop ? this.topBrain : this.bottomBrain;
    if (!brain) return;

    brain.recordContact();
    this.recordAimError(isTop ? this.topStats : this.bottomStats, brain, event.pos);
  }

  /** 宣言した狙いと実際の飛翔方向の差を記録する (物理理解度の指標) */
  private recordAimError(stats: AgentStats, brain: AgentBrainUseCase, contactPos: Vec2): void {
    const plan = brain.getPlan();
    if (!plan) return;

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
    this.physics.resetPositions(side);
    // resetPositions は Math.random を使うため、再現性のためにシード付きで上書きする
    const puck = this.physics.getPuck();
    puck.vel.set((this.rng() - 0.5) * 120, side === "PLAYER" ? -240 : 240);

    this.topBrain.reset();
    this.bottomBrain?.reset();
  }

  private notifyState(): void {
    this.onStateChange?.({ ...this.matchState });
  }
}
