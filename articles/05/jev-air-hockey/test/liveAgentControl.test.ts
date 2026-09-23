/**
 * Live API Agent Control Tests (Vitest)
 *
 * 「APIキーを設定したのに、実際に動かしていたのはローカルCPUだった」を
 * 起こさないための保証。
 *   - クラウドAPIのエージェントが返した計画だけがマレットを動かすこと
 *   - 応答が遅いエージェントでも、その判断が実際に次の一打を決められること
 *     (判断待ちで時間が止まる)
 *   - 応答が失敗したときにローカル演算で代替しないこと
 */

import { describe, it, expect } from "vitest";
import { GameLoopUseCase } from "../src/usecases/gameLoopUseCase";
import { PhysicsEngine } from "../src/usecases/physicsEngine";
import { AgentBrainUseCase } from "../src/usecases/agentBrainUseCase";
import { CpuAgentClient } from "../src/adapters/cpuAgentClient";
import { IAgentClient, AirHockeyObservation } from "../src/adapters/agentClient";
import { AgentType, AgentTelemetry } from "../src/domain/jevAgentTypes";
import { DEFAULT_STADIUM_CONFIG as CFG } from "../src/domain/gameState";
import { ISoundSynthesizer } from "../src/adapters/soundSynthesizer";
import { Vec2 } from "../src/domain/physics";
import { validateShotPlan } from "../src/domain/shotPlanValidator";
import { predictPuckPath } from "../src/domain/puckPredictor";
import { limitsFor, solveIntercept } from "../src/domain/interception";

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
 * クラウドAPIのエージェントを模したクライアント。
 * 応答に実時間の遅延があり、狙いは呼び出し側が指定した固定値を返す。
 * 軌道は正しく読むが、lateralErrorPx を与えると打点の予測を横にその分だけ外す。
 */
class FakeLiveAgent implements IAgentClient {
  readonly type = AgentType.CLAUDE;
  readonly usesLiveApi = true;
  calls = 0;

  constructor(
    private readonly aim: Vec2,
    private readonly delayMs: number,
    private readonly failing = false,
    private readonly lateralErrorPx = 0
  ) {}

  async decideShot(obs: AirHockeyObservation): Promise<AgentTelemetry> {
    this.calls++;
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));

    if (this.failing) {
      return {
        plan: null,
        status: "ERROR",
        rawLatencyMs: this.delayMs,
        clampNotes: ["模擬的な通信失敗"],
        isLiveApi: true,
        latestChat: null,
      };
    }

    const { config } = obs;
    const limits = limitsFor(obs.side, config);
    const swingSpeed = config.maxMalletSpeed;
    const sol = solveIntercept(
      predictPuckPath(obs.puckPos, obs.puckVel, config),
      obs.myMalletPos,
      obs.myMalletVel,
      this.aim,
      limits,
      config,
      {
        swingSpeed,
        maxLookaheadSec: 1.4,
        setupSec: swingSpeed / limits.maxAccel + 0.04,
        windupPx: Math.min(150, (swingSpeed * swingSpeed) / (2 * limits.maxAccel)),
      }
    )!;

    const result = validateShotPlan(
      {
        interceptPoint: { x: sol.contactPoint.x + this.lateralErrorPx, y: sol.contactPoint.y },
        contactTimeMs: sol.contactTime * 1000,
        aimPoint: { x: this.aim.x, y: this.aim.y },
        swingDirDeg: (Math.atan2(sol.swingDir.y, sol.swingDir.x) * 180) / Math.PI,
        swingSpeed,
      },
      obs.side,
      obs.config
    );

    return {
      plan: result.plan,
      status: result.status,
      rawLatencyMs: this.delayMs,
      clampNotes: result.clampNotes,
      isLiveApi: true,
      latestChat: null,
    };
  }
}

function buildLoop(topClient: IAgentClient, bottomClient: IAgentClient | null) {
  const physics = new PhysicsEngine(CFG);
  const topBrain = new AgentBrainUseCase(topClient, CFG, "TOP", AgentType.CLAUDE);
  const loop = new GameLoopUseCase(
    physics,
    topBrain,
    new SilentSound(),
    CFG,
    AgentType.CLAUDE,
    bottomClient ? AgentType.CPU : AgentType.HUMAN
  );

  // setMatchup が作り直したクライアントを、模擬クライアントへ差し替える
  loop.getTopBrain().setClient(topClient, AgentType.CLAUDE);
  if (bottomClient) loop.getBottomBrain()!.setClient(bottomClient, AgentType.CPU);

  return { physics, loop };
}

describe("Live API agent in a 1v1 match", () => {
  it("should stop the clock while a cloud agent is thinking, without being told to", async () => {
    const { loop } = buildLoop(new FakeLiveAgent(new Vec2(300, CFG.height + 30), 40), new CpuAgentClient());

    // トーナメントでなくても、クラウドAPIが出ているなら判断待ちで時間を止める。
    // 止めないと応答が返る前にラリーが終わり、AIを差し替えても展開が変わらない
    expect(loop.isWaitingForDecisions()).toBe(true);
  });

  it("should run in real time when only local agents play", async () => {
    const { loop } = buildLoop(new CpuAgentClient(), new CpuAgentClient());
    loop.getTopBrain().setClient(new CpuAgentClient(), AgentType.CPU);
    expect(loop.isWaitingForDecisions()).toBe(false);
  });

  it("should let a slow agent's declared aim actually decide the shot", async () => {
    // 左右で違う狙いを宣言させ、打球の向きがその宣言に従うことを確かめる
    const results: Array<{ aimX: number; puckVx: number; calls: number }> = [];

    for (const aimX of [80, 520]) {
      const agent = new FakeLiveAgent(new Vec2(aimX, CFG.height + 30), 30);
      const { physics, loop } = buildLoop(agent, null);
      loop.startMatch(7, 5);

      const puck = physics.getPuck();
      puck.pos.set(300, 520);
      puck.vel.set(0, -700);
      physics.getPlayerMallet().pos.set(CFG.malletRadius, CFG.height - CFG.malletRadius);

      let contactVx = 0;
      for (let i = 0; i < 200 && contactVx === 0; i++) {
        await loop.advance(4);
        if (puck.vel.y > 0) contactVx = puck.vel.x; // 打ち返された
      }

      results.push({ aimX, puckVx: contactVx, calls: agent.calls });
    }

    for (const r of results) {
      expect(r.calls).toBeGreaterThan(0); // 実際に問い合わせている
      expect(r.puckVx).not.toBe(0);
    }

    // 左を狙った打球は左へ、右を狙った打球は右へ飛ぶ
    expect(results[0].puckVx).toBeLessThan(0);
    expect(results[1].puckVx).toBeGreaterThan(0);
  }, 60000);

  it("should ask only once, when the puck crosses the center line", async () => {
    const agent = new FakeLiveAgent(new Vec2(300, CFG.height + 30), 10);
    const { physics, loop } = buildLoop(agent, null);
    loop.startMatch(7, 5);

    const puck = physics.getPuck();
    puck.pos.set(300, 700);
    puck.vel.set(60, -700);
    physics.getPlayerMallet().pos.set(CFG.malletRadius, CFG.height - CFG.malletRadius);

    // 中央線より手前では一度も問い合わせない
    for (let i = 0; i < 20 && puck.pos.y > CFG.height * 0.5 + 10; i++) await loop.advance(1);
    expect(agent.calls).toBe(0);

    // 越えた瞬間に1回。その後は壁で跳ねても打ち返しても考え直さない
    let touched = false;
    for (let i = 0; i < 80 && !touched; i++) {
      await loop.advance(1);
      if (puck.vel.y > 0) touched = true;
    }
    expect(touched).toBe(true);
    expect(agent.calls).toBe(1);
  }, 30000);

  it("should miss when the agent mispredicts where the puck will be", async () => {
    // 同じ盤面で、打点だけを横に読み違えたエージェントと比べる
    // (時刻の読み違いは、パックの進路に沿って振り抜く限り振り抜きの途中で拾えることがある)
    const outcomes: boolean[] = [];

    for (const lateralErrorPx of [0, -90, 90]) {
      const agent = new FakeLiveAgent(new Vec2(300, CFG.height + 30), 10, false, lateralErrorPx);
      const { physics, loop } = buildLoop(agent, null);
      loop.startMatch(7, 5);

      const puck = physics.getPuck();
      puck.pos.set(180, 520);
      puck.vel.set(420, -900);
      physics.getPlayerMallet().pos.set(CFG.malletRadius, CFG.height - CFG.malletRadius);

      let firstContact: boolean | null = null;
      loop.setCallbacks(
        () => {},
        (event) => {
          // 最初の接触が、エージェントが予告した一撃によるものか
          // (外した後のローカルの掻き出しや、偶発的なブロックは含めない)
          if (event.type !== "PUCK_MALLET_JEV" || firstContact !== null) return;
          const brain = loop.getTopBrain();
          firstContact = brain.isExecutingStrike() && brain.getPlannedPath() !== null;
        }
      );

      for (let i = 0; i < 120 && firstContact === null && !loop.isFinished(); i++) await loop.advance(1);
      outcomes.push(firstContact === true);
    }

    // 正しく読めば当たり、読み違えればサーボは補正しないので空振りする
    expect(outcomes).toEqual([true, false, false]);
  }, 30000);

  it("should not substitute local tactics when the API fails", async () => {
    const failing = new FakeLiveAgent(new Vec2(300, CFG.height + 30), 10, true);
    const { physics, loop } = buildLoop(failing, null);
    loop.startMatch(7, 5);

    const puck = physics.getPuck();
    puck.pos.set(300, 520);
    puck.vel.set(0, -700);

    // 応答が失敗して返ってくるまで進める。パックはまだ自陣ゴールへ向かっている
    for (let i = 0; i < 60 && loop.getTopBrain().getTelemetry() === null; i++) await loop.advance(1);
    await loop.advance(2);
    expect(puck.vel.y).toBeLessThan(0);

    expect(failing.calls).toBeGreaterThan(0);
    // 計画は一切与えられない。ローカルの戦術で代替しないこと
    expect(loop.getTopBrain().getPlan()).toBeNull();
    expect(loop.getTopBrain().getTelemetry()?.status).toBe("ERROR");
    // パックを読んで守ったり打ったりもしない (= CPU モードにならない)。定位置で待つだけ
    expect(loop.getTopBrain().getMode()).toBe("NO_PLAN");

    // 定位置はパックの位置によらない。自陣ゴールへ向かう球でも追いかけない
    for (let i = 0; i < 40; i++) await loop.advance(1);
    const mallet = physics.getJevMallet();
    expect(mallet.pos.x).toBeCloseTo(CFG.width * 0.5, 0);
    expect(mallet.pos.y).toBeCloseTo(CFG.height * 0.18, 0);
    expect(loop.getStats().top.errors).toBeGreaterThan(0);
  }, 60000);
});
