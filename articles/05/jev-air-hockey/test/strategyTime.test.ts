/**
 * Strategy Time (作戦タイム) Tests (Vitest)
 *
 *   - 試合前に AI も CPU も作戦を立て、揃ってからカウントダウンでサーブする
 *   - 通信に失敗した局面は、そのAI自身が立てた作戦で打つ (CPU が肩代わりしない)
 *   - 自陣に居座る球は、作戦で打ちに行く
 */

import { describe, it, expect } from "vitest";
import { GameLoopUseCase } from "../src/usecases/gameLoopUseCase";
import { PhysicsEngine } from "../src/usecases/physicsEngine";
import { AgentBrainUseCase } from "../src/usecases/agentBrainUseCase";
import { CpuAgentClient } from "../src/adapters/cpuAgentClient";
import { IAgentClient, AirHockeyObservation, PlaybookContext, PlaybookTelemetry } from "../src/adapters/agentClient";
import { AgentType, AgentTelemetry } from "../src/domain/jevAgentTypes";
import { DEFAULT_STADIUM_CONFIG as CFG, GameStatus } from "../src/domain/gameState";
import { ISoundSynthesizer } from "../src/adapters/soundSynthesizer";
import { failureTelemetry, playbookFailure, toPlaybookTelemetry } from "../src/adapters/llmShotPlanner";
import { Playbook } from "../src/domain/playbook";
import { beforeAll } from "vitest";

beforeAll(async () => {
  for (const side of ["TOP", "BOTTOM"] as const) {
    const t = await new CpuAgentClient().decidePlaybook({ side, config: CFG, targetScore: 7 });
    cpuPlaybooks.set(side, t.playbook!);
  }
});

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
 * 判断は必ず通信に失敗するが、作戦タイムには作戦を返すクラウドAI。
 * 作戦の中身は CPU と同じもの (あくまで「このAIが立てた作戦」として渡す)。
 */
class FlakyLiveAgent implements IAgentClient {
  readonly type = AgentType.CLAUDE;
  readonly usesLiveApi = true;
  shotCalls = 0;
  playbookCalls: PlaybookContext[] = [];

  /**
   * playbookMode:
   *   ok          — 抜け漏れの無い作戦を返す
   *   timeout     — 時間切れ
   *   incomplete  — 毎回1局面欠けた作戦を返す
   *   fixOnRetry  — 初回は1局面欠けているが、作り直しを求められたら直す
   */
  constructor(private readonly playbookMode: "ok" | "timeout" | "incomplete" | "fixOnRetry" = "ok") {}

  async decideShot(_obs: AirHockeyObservation): Promise<AgentTelemetry> {
    this.shotCalls++;
    return failureTelemetry("ERROR", "Failed to fetch", 5);
  }

  async decidePlaybook(ctx: PlaybookContext): Promise<PlaybookTelemetry> {
    this.playbookCalls.push(ctx);
    if (this.playbookMode === "timeout") return playbookFailure("TIMEOUT", "時間切れ", 60000);

    const raw = JSON.parse(JSON.stringify(CPU_RAW(ctx)));
    const broken = this.playbookMode === "incomplete" || (this.playbookMode === "fixOnRetry" && !ctx.previousIssues);
    if (broken) delete raw.incoming.THREAT_SLOW;
    return toPlaybookTelemetry(raw, ctx, 5);
  }
}

/** CPU の作戦を生データの形で取り出す (このAIが立てた作戦として渡す) */
function CPU_RAW(ctx: PlaybookContext) {
  const pb = cpuPlaybook(ctx);
  return {
    readyPosition: { x: pb.readyPosition.x, y: pb.readyPosition.y },
    cpuStyle: takeoverStyle,
    incoming: pb.incoming,
    lingering: pb.lingering,
  };
}

const cpuPlaybooks = new Map<string, Playbook>();
/** このAIが作戦タイムに選ぶ CPU代行の動作パターン */
let takeoverStyle = "SAFE_CLEAR";
function cpuPlaybook(ctx: PlaybookContext): Playbook {
  return cpuPlaybooks.get(ctx.side)!;
}

function buildLoop(top: IAgentClient, bottom: IAgentClient | null) {
  const physics = new PhysicsEngine(CFG);
  const brain = new AgentBrainUseCase(top, CFG, "TOP", AgentType.CLAUDE);
  const loop = new GameLoopUseCase(physics, brain, new SilentSound(), CFG, AgentType.CLAUDE, bottom ? AgentType.CPU : AgentType.HUMAN);
  loop.getTopBrain().setClient(top, AgentType.CLAUDE);
  if (bottom) loop.getBottomBrain()!.setClient(bottom, AgentType.CPU);
  return { physics, loop };
}

describe("Strategy time before the match", () => {
  it("should let both sides plan, then count down, then serve", async () => {
    const { physics, loop } = buildLoop(new FlakyLiveAgent(), new CpuAgentClient());
    const states: GameStatus[] = [];
    loop.setCallbacks((s) => states.push(s.status), () => {});

    await loop.prepareMatch(7, 1);

    expect(states[0]).toBe(GameStatus.STRATEGY);
    expect(loop.getMatchState().status).toBe(GameStatus.COUNTDOWN);
    expect(loop.getMatchState().strategy).toEqual({ top: "READY", bottom: "READY" });
    expect(loop.getTopBrain().getPlaybook()).not.toBeNull();
    expect(loop.getBottomBrain()!.getPlaybook()).not.toBeNull();

    // カウントダウン中はパックが動かない
    await loop.advance(Math.round(2.9 / CFG.fixedDt));
    expect(loop.getMatchState().status).toBe(GameStatus.COUNTDOWN);
    expect(physics.getPuck().vel.mag()).toBe(0);

    await loop.advance(Math.round(0.2 / CFG.fixedDt));
    expect(loop.getMatchState().status).toBe(GameStatus.PLAYING);
    expect(physics.getPuck().vel.mag()).toBeGreaterThan(0);
  });

  it("should not start when an AI cannot make a playbook", async () => {
    const agent = new FlakyLiveAgent("timeout");
    const { physics, loop } = buildLoop(agent, new CpuAgentClient());
    const started = await loop.prepareMatch(7, 1);

    expect(started).toBe(false);
    expect(loop.getMatchState().status).toBe(GameStatus.READY);
    expect(loop.getMatchState().strategy.top).toBe("FAILED");
    expect(loop.getMatchState().strategyError).toContain("時間切れ");
    // 時間切れは作り直しても同じになりやすいので繰り返さない
    expect(agent.playbookCalls).toHaveLength(1);

    // 進めても試合は始まらない
    await loop.advance(Math.round(4 / CFG.fixedDt));
    expect(loop.getMatchState().status).toBe(GameStatus.READY);
    expect(physics.getPuck().vel.mag()).toBe(0);
  });

  it("should make the AI redo a playbook with gaps, telling it what was missing", async () => {
    const agent = new FlakyLiveAgent("fixOnRetry");
    const { loop } = buildLoop(agent, new CpuAgentClient());
    const started = await loop.prepareMatch(7, 1);

    expect(started).toBe(true);
    expect(loop.getMatchState().strategy.top).toBe("READY");
    expect(agent.playbookCalls).toHaveLength(2);
    expect(agent.playbookCalls[1].previousIssues).toEqual(["incoming.THREAT_SLOW が無い"]);
  });

  it("should give up after three attempts if the gaps are never fixed", async () => {
    const agent = new FlakyLiveAgent("incomplete");
    const { loop } = buildLoop(agent, new CpuAgentClient());
    const started = await loop.prepareMatch(7, 1);

    expect(started).toBe(false);
    expect(agent.playbookCalls).toHaveLength(3);
    expect(loop.getMatchState().strategyError).toContain("incoming.THREAT_SLOW が無い");
  });
});

describe("Playing by the playbook", () => {
  it("should hit a puck with its own playbook when the decision fails to arrive", async () => {
    const agent = new FlakyLiveAgent();
    const { physics, loop } = buildLoop(agent, null);
    await loop.prepareMatch(7, 5);
    await loop.advance(Math.round(3.1 / CFG.fixedDt));

    const puck = physics.getPuck();
    puck.pos.set(300, 520);
    puck.vel.set(80, -700);

    let struck = false;
    let situation: string | null = null;
    loop.setCallbacks(() => {}, (e) => {
      if (e.type === "PUCK_MALLET_JEV") struck = true;
    });

    for (let i = 0; i < 150 && !struck; i++) {
      await loop.advance(1);
      situation = loop.getTopBrain().getActiveSituation() ?? situation;
    }

    expect(agent.shotCalls).toBe(1);                         // 判断は求めた (そして失敗した)
    expect(loop.getTopBrain().getTelemetry()?.status).toBe("ERROR");
    expect(situation).toBe("THREAT_SLOW");                   // 作戦の「遅い球がゴールへ来る」局面
    expect(struck).toBe(true);                                // その作戦で打った
  });

  it("should go after a puck lingering in its half for 2 seconds, by its playbook", async () => {
    const agent = new FlakyLiveAgent();
    const { physics, loop } = buildLoop(agent, null);
    await loop.prepareMatch(7, 5);
    await loop.advance(Math.round(3.1 / CFG.fixedDt));

    // 中央線を越えずに自陣の左壁沿いを往復する球 (判断の機会が無い)
    const puck = physics.getPuck();
    puck.pos.set(30, 400);
    puck.vel.set(0, -90);

    let touchedAt: number | null = null;
    let situation: string | null = null;
    loop.setCallbacks(() => {}, (e) => {
      if (e.type === "PUCK_MALLET_JEV" && touchedAt === null) touchedAt = loop.getMatchState().matchDurationSec;
    });

    const start = loop.getMatchState().matchDurationSec;
    for (let i = 0; i < 600 && touchedAt === null; i++) {
      await loop.advance(1);
      situation = loop.getTopBrain().getActiveSituation() ?? situation;
      // 2秒経つまでは作戦も判断も無いので、待機位置で待つだけ
      if (loop.getMatchState().matchDurationSec - start < 1.9) {
        expect(loop.getTopBrain().getMode()).toBe("NO_PLAN");
      }
    }

    expect(agent.shotCalls).toBe(0);
    expect(situation).toBe("WALL_SHUTTLE_LEFT");
    expect(touchedAt).not.toBeNull();
    expect(touchedAt! - start).toBeGreaterThanOrEqual(2);
  });
});

describe("CPU takeover", () => {
  it("should let the CPU handle a situation the playbook has no move for", async () => {
    const agent = new FlakyLiveAgent();
    const { physics, loop } = buildLoop(agent, null);
    await loop.prepareMatch(7, 5);
    await loop.advance(Math.round(3.1 / CFG.fixedDt));

    // 作戦のうち、この局面の手だけが使えない状態にする
    const pb = loop.getTopBrain().getPlaybook()!;
    const { THREAT_SLOW: _removed, ...rest } = pb.incoming;
    loop.getTopBrain().setPlaybook({ ...pb, incoming: rest });

    const puck = physics.getPuck();
    puck.pos.set(300, 520);
    puck.vel.set(80, -700);

    let struck = false;
    let note: string | null = null;
    loop.setCallbacks(() => {}, (e) => {
      if (e.type === "PUCK_MALLET_JEV") struck = true;
    });

    for (let i = 0; i < 150 && !struck; i++) {
      await loop.advance(1);
      note = loop.getTopBrain().getControlNote() ?? note;
    }

    expect(loop.getTopBrain().getTelemetry()?.status).toBe("ERROR");
    expect(note).toContain("CPU代行");
    expect(note).toContain("THREAT_SLOW");
    expect(struck).toBe(true);
    expect(loop.getStats().top.cpuTakeovers).toBe(1);
    // AI が作戦タイムに選んだ動作パターン (安全第一) で CPU が打った: 相手ゴールではなく奥へ逃がす
    expect(note).toContain("[SAFE_CLEAR]");
    expect(loop.getTopBrain().getPlan()!.aimPoint.y).toBeLessThan(CFG.height);
  });
});
