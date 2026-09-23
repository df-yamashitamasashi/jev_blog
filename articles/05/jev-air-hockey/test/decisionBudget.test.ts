/**
 * Latency Fairness Tests (Vitest)
 *
 * ベンチマークの根幹: 実測レイテンシが違っても、消費されるシミュレーション時間は
 * 同一でなければならない。そうでないと「推論力」ではなく「回線速度」を測ることになる。
 *
 * この公平タイミング (fairTiming) はトーナメント実行時のみ有効になる。
 * 通常のライブ対戦では無効 (実時間で進行し、遅いAIは普通に空振りする) なので、
 * このテストでは明示的に setFairTiming(true) を呼ぶ。
 */

import { describe, it, expect } from "vitest";
import { GameLoopUseCase } from "../src/usecases/gameLoopUseCase";
import { PhysicsEngine } from "../src/usecases/physicsEngine";
import { AgentBrainUseCase } from "../src/usecases/agentBrainUseCase";
import { CpuAgentClient } from "../src/adapters/cpuAgentClient";
import { IAgentClient, AirHockeyObservation } from "../src/adapters/agentClient";
import { AgentType, AgentTelemetry } from "../src/domain/jevAgentTypes";
import { DEFAULT_STADIUM_CONFIG as CFG, GameStatus } from "../src/domain/gameState";
import { ISoundSynthesizer } from "../src/adapters/soundSynthesizer";

class SilentSound implements ISoundSynthesizer {
  playHitPuck = () => {};
  playWallBounce = () => {};
  playSmashHit = () => {};
  playGoal = () => {};
  playCountDown = () => {};
  toggleBgm = () => {};
  isBgmActive = () => false;
}

/**
 * クラウドAPIの通信遅延を模したラッパー。判断内容そのものは一切変えない
 * (中身は CPU の幾何解なので、同じ盤面なら同じ判断になる)。
 */
class DelayedClient implements IAgentClient {
  readonly usesLiveApi = true;

  constructor(private readonly inner: IAgentClient, private readonly delayMs: number) {}

  get type(): AgentType {
    return this.inner.type;
  }

  async decideShot(obs: AirHockeyObservation): Promise<AgentTelemetry> {
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    return this.inner.decideShot(obs);
  }
}

async function playMatch(delayMs: number) {
  const physics = new PhysicsEngine(CFG);
  const topBrain = new AgentBrainUseCase(new CpuAgentClient(), CFG, "TOP", AgentType.CPU);
  const loop = new GameLoopUseCase(
    physics,
    topBrain,
    new SilentSound(),
    CFG,
    AgentType.CPU,
    AgentType.CPU
  );

  // setMatchup 後のクライアントを遅延付きに差し替える
  loop.getTopBrain().setClient(new DelayedClient(new CpuAgentClient(), delayMs), AgentType.CPU);
  loop
    .getBottomBrain()!
    .setClient(new DelayedClient(new CpuAgentClient(), delayMs), AgentType.CPU);

  loop.setFairTiming(true);
  loop.startMatch(2, 1234, 25);

  const startedAt = Date.now();
  for (let i = 0; i < 500 && !loop.isFinished(); i++) {
    await loop.advance(120);
  }

  const state = loop.getMatchState();
  return {
    finished: loop.isFinished(),
    wallClockMs: Date.now() - startedAt,
    simSeconds: state.matchDurationSec,
    score: `${state.score.jev}-${state.score.player}`,
    rallies: state.rallyCount,
  };
}

describe("Latency fairness", () => {
  it("should produce an identical match regardless of API latency", async () => {
    const fast = await playMatch(0);
    const slow = await playMatch(80);

    expect(fast.finished).toBe(true);
    expect(slow.finished).toBe(true);

    // 実時間は遅い方が明確に長いが…
    expect(slow.wallClockMs).toBeGreaterThan(fast.wallClockMs);

    // …ゲーム内の結果は完全に一致する
    expect(slow.score).toBe(fast.score);
    expect(slow.rallies).toBe(fast.rallies);
    expect(slow.simSeconds).toBeCloseTo(fast.simSeconds, 6);
  }, 30000);

  it("should consume exactly the decision budget of simulation time per cloud decision", async () => {
    const physics = new PhysicsEngine(CFG);
    const brain = new AgentBrainUseCase(new CpuAgentClient(), CFG, "TOP", AgentType.CPU);
    const loop = new GameLoopUseCase(physics, brain, new SilentSound(), CFG, AgentType.CPU, AgentType.CPU);
    loop.getTopBrain().setClient(new DelayedClient(new CpuAgentClient(), 5), AgentType.CLAUDE);

    loop.setFairTiming(true);
    loop.startMatch(9, 5, 400);

    // パックが中央線を越えて上へ向かっている状態から1判断ぶんだけ進める
    const puck = physics.getPuck();
    puck.pos.set(CFG.width * 0.5, CFG.height * 0.5);
    puck.vel.set(0, -600);

    const before = loop.getMatchState().matchDurationSec;
    await loop.advance(1);
    const elapsedMs = (loop.getMatchState().matchDurationSec - before) * 1000;

    expect(loop.getMatchState().status).toBe(GameStatus.PLAYING);
    // 判断が走ったフレームでは、思考予算ぶんの時間だけが進む
    expect(elapsedMs).toBeCloseTo(CFG.decisionBudgetMs, 3);
  });

  it("should let the CPU decide on the center line without stopping the clock", async () => {
    const physics = new PhysicsEngine(CFG);
    const brain = new AgentBrainUseCase(new CpuAgentClient(), CFG, "TOP", AgentType.CPU);
    const loop = new GameLoopUseCase(physics, brain, new SilentSound(), CFG, AgentType.CPU, AgentType.CPU);

    // トーナメント同様に公平タイミングを有効にしても、CPU は通信しないので止まらない
    loop.setFairTiming(true);
    loop.startMatch(9, 5, 400);

    const puck = physics.getPuck();
    puck.pos.set(CFG.width * 0.5, CFG.height * 0.5);
    puck.vel.set(0, -600);

    const before = loop.getMatchState().matchDurationSec;
    await loop.advance(1);
    const elapsedMs = (loop.getMatchState().matchDurationSec - before) * 1000;

    // 判断はこのステップで確定している
    expect(loop.getTopBrain().getPlan()).not.toBeNull();
    expect(loop.getStats().top.decisions).toBe(1);
    // それでも進んだのは物理1ステップぶんだけ
    expect(elapsedMs).toBeCloseTo(CFG.fixedDt * 1000, 3);
  });
});

describe("Live match timing (fairTiming disabled, the default)", () => {
  it("should not block simulation progress while a decision is pending", async () => {
    const physics = new PhysicsEngine(CFG);
    const topBrain = new AgentBrainUseCase(new CpuAgentClient(), CFG, "TOP", AgentType.CPU);
    const loop = new GameLoopUseCase(
      physics,
      topBrain,
      new SilentSound(),
      CFG,
      AgentType.CPU,
      AgentType.CPU
    );

    // 現実のAPI遅延を模して、意図的に「絶対に速攻では解決しない」クライアントにする
    const SLOW_MS = 500;
    loop.getTopBrain().setClient(new DelayedClient(new CpuAgentClient(), SLOW_MS), AgentType.CPU);
    loop.getBottomBrain()!.setClient(new DelayedClient(new CpuAgentClient(), SLOW_MS), AgentType.CPU);

    loop.setFairTiming(false);
    loop.startMatch(9, 1, 2000);

    const puck = physics.getPuck();
    puck.pos.set(CFG.width * 0.5, CFG.height * 0.5);
    puck.vel.set(0, -500); // 判断が必要になるようTOP側へ向かわせる

    const before = loop.getMatchState().matchDurationSec;
    const wallStart = Date.now();

    // 遅延(500ms)よりずっと短い時間しかかからないはず — ブロックしていれば
    // ここで500ms以上かかる
    await loop.advance(30);

    const wallElapsedMs = Date.now() - wallStart;
    const simElapsedSec = loop.getMatchState().matchDurationSec - before;

    expect(wallElapsedMs).toBeLessThan(SLOW_MS);
    // 判断待ちでもシミュレーション時間は実時間相当で進み続けている
    expect(simElapsedSec).toBeCloseTo(30 * CFG.fixedDt, 6);
  });
});
