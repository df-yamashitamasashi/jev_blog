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
 */
class FakeLiveAgent implements IAgentClient {
  readonly type = AgentType.CLAUDE;
  readonly usesLiveApi = true;
  calls = 0;

  constructor(
    private readonly aim: Vec2,
    private readonly delayMs: number,
    private readonly failing = false
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

    // 接触法線の幾何は指定した狙いから決まる。ここでは狙いだけを宣言する
    const result = validateShotPlan(
      {
        interceptPoint: { x: obs.myMalletPos.x, y: obs.myMalletPos.y },
        aimPoint: { x: this.aim.x, y: this.aim.y },
        swingDirDeg: 90,
        swingSpeed: obs.config.maxMalletSpeed,
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

  it("should not substitute local tactics when the API fails", async () => {
    const failing = new FakeLiveAgent(new Vec2(300, CFG.height + 30), 10, true);
    const { physics, loop } = buildLoop(failing, null);
    loop.startMatch(7, 5);

    const puck = physics.getPuck();
    puck.pos.set(300, 520);
    puck.vel.set(0, -700);

    for (let i = 0; i < 60; i++) await loop.advance(4);

    expect(failing.calls).toBeGreaterThan(0);
    // 計画は一切与えられない。ローカルの戦術で代替しないこと
    expect(loop.getTopBrain().getPlan()).toBeNull();
    expect(loop.getTopBrain().getTelemetry()?.status).toBe("ERROR");
    // それでも守備位置へは動く (棒立ちにはならない)
    expect(loop.getTopBrain().getMode()).toBe("DEFEND");
    expect(loop.getStats().top.errors).toBeGreaterThan(0);
  }, 60000);
});
