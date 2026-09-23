/**
 * Agent Servo Behaviour Tests (Vitest)
 *
 * 作り直し前に実測で壊れていた局面をそのまま固定する。当時の挙動:
 *   - 正面からの速球: 迎撃点で停止し、止まったマレットに当たるだけ (球威なし)
 *   - 自陣で停止したパック: 2.5秒間マレット速度 0 のまま完全に無反応
 *   - 自陣を横切るパック: 同じく無反応。触れないまま往復させ続ける
 *   - 回り込み中に自陣ゴールへパックを押し込む (自殺点) が発生
 */

import { describe, it, expect } from "vitest";
import { PhysicsEngine } from "../src/usecases/physicsEngine";
import { AgentBrainUseCase } from "../src/usecases/agentBrainUseCase";
import { CpuAgentClient } from "../src/adapters/cpuAgentClient";
import { AgentType } from "../src/domain/jevAgentTypes";
import { DEFAULT_STADIUM_CONFIG as CFG } from "../src/domain/gameState";

interface PuckState {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface Observation {
  touched: boolean;
  goal: "GOAL_PLAYER" | "GOAL_JEV" | null;
  /** 打ち返した瞬間のパック速度 (px/s) */
  returnSpeed: number;
  /** 打ち返した瞬間のパックの y 方向 (正 = 相手ゴール側へ) */
  returnTowardOpponent: boolean;
  /** マレットが動いていたステップの割合 */
  activeRatio: number;
  /** 最初に動き出すまでの秒数 (旧実装は永久に動かなかった) */
  firstMoveSec: number;
  maxMalletSpeed: number;
}

/** TOP側エージェントだけを動かして、決め打ちの盤面での挙動を観測する */
async function runTopAgent(puck: PuckState, steps: number): Promise<Observation> {
  const physics = new PhysicsEngine(CFG);
  const brain = new AgentBrainUseCase(new CpuAgentClient(), CFG, "TOP", AgentType.CPU);

  const p = physics.getPuck();
  p.pos.set(puck.x, puck.y);
  p.vel.set(puck.vx, puck.vy);
  p.spin = 0;

  const mallet = physics.getJevMallet();
  mallet.pos.set(CFG.width * 0.5, CFG.height * 0.18);
  mallet.vel.set(0, 0);

  // 相手マレットは邪魔にならない位置へ固定 (TOP側の挙動だけを見たい)
  physics.getPlayerMallet().pos.set(CFG.malletRadius, CFG.height - CFG.malletRadius);

  const result: Observation = {
    touched: false,
    goal: null,
    returnSpeed: 0,
    returnTowardOpponent: false,
    activeRatio: 0,
    firstMoveSec: Number.POSITIVE_INFINITY,
    maxMalletSpeed: 0,
  };

  let movingSteps = 0;

  for (let i = 0; i < steps; i++) {
    const obs = brain.observe(p);
    if (obs.needsDecision) {
      await brain.requestDecision(p, mallet, physics.getPlayerMallet(), 0, 0);
    }
    brain.stepServo(CFG.fixedDt, mallet, p);

    const speed = mallet.vel.mag();
    if (speed > 20) {
      movingSteps++;
      result.firstMoveSec = Math.min(result.firstMoveSec, i * CFG.fixedDt);
    }
    result.maxMalletSpeed = Math.max(result.maxMalletSpeed, speed);

    const goal = physics.step(CFG.fixedDt, (event) => {
      if (event.type !== "PUCK_MALLET_JEV") return;
      if (!result.touched) {
        result.touched = true;
        result.returnSpeed = p.vel.mag();
        result.returnTowardOpponent = p.vel.y > 0;
      }
    });

    if (goal) {
      result.goal = goal;
      break;
    }
  }

  result.activeRatio = movingSteps / steps;
  return result;
}

describe("Agent servo — situations that used to be broken", () => {
  it("should smash a fast puck coming straight at it", async () => {
    const r = await runTopAgent({ x: 300, y: 700, vx: 0, vy: -900 }, 200);

    expect(r.touched).toBe(true);
    expect(r.returnTowardOpponent).toBe(true);
    // 止まったマレットに当たるだけなら入射速度程度 (900前後) で返る。
    // 振り抜けていれば明確に上回る
    expect(r.returnSpeed).toBeGreaterThan(1100);
    expect(r.goal).not.toBe("GOAL_PLAYER");
  });

  it("should attack a puck sitting still in its own half", async () => {
    const r = await runTopAgent({ x: 300, y: 150, vx: 0, vy: 0 }, 300);

    // 旧実装はここで 2.5 秒以上まったく動かなかった。
    // 打点を決めて構えたあと接触時刻まで待つのは正しい動作なので、
    // 「止まっている時間があるか」ではなく「すぐ動き出すか」を見る
    expect(r.firstMoveSec).toBeLessThan(0.2);
    expect(r.activeRatio).toBeGreaterThan(0.2);
    expect(r.touched).toBe(true);
    // 自陣ゴールへ押し込まないこと
    expect(r.goal).not.toBe("GOAL_PLAYER");
  });

  it("should chase a puck drifting sideways across its own half", async () => {
    const r = await runTopAgent({ x: 60, y: 200, vx: 420, vy: 5 }, 300);

    expect(r.firstMoveSec).toBeLessThan(0.2);
    expect(r.activeRatio).toBeGreaterThan(0.2);
    expect(r.touched).toBe(true);
    expect(r.goal).not.toBe("GOAL_PLAYER");
  });

  it("should move on a slow puck instead of waiting for it to arrive", async () => {
    const r = await runTopAgent({ x: 300, y: 500, vx: 0, vy: -90 }, 420);

    expect(r.touched).toBe(true);
    expect(r.returnTowardOpponent).toBe(true);
    expect(r.goal).not.toBe("GOAL_PLAYER");
  });

  it("should cover a puck arriving at a sharp angle", async () => {
    const r = await runTopAgent({ x: 80, y: 700, vx: 520, vy: -820 }, 220);

    expect(r.touched).toBe(true);
    expect(r.goal).not.toBe("GOAL_PLAYER");
  });

  it("should save a shot aimed at its own goal", async () => {
    // 旧実装はこの局面で触れずに失点していた
    const r = await runTopAgent({ x: 520, y: 640, vx: 420, vy: -700 }, 220);

    expect(r.touched).toBe(true);
    expect(r.goal).not.toBe("GOAL_PLAYER");
  });

  it("should go after a puck running along the side wall, even though it will not score", async () => {
    // ゴールに入らない壁沿いの球。旧実装は「守る必要がない」と判断して一切手を出さず、
    // 左端・右端を往復させ続けていた
    for (const start of [
      { x: 22, y: 470, vx: 0, vy: -700 },
      { x: 578, y: 470, vx: 0, vy: -500 },
      { x: 30, y: 470, vx: -40, vy: -1200 },
    ]) {
      const r = await runTopAgent(start, 300);
      expect(r.touched).toBe(true);
      expect(r.goal).not.toBe("GOAL_PLAYER");
    }
  });

  it("should chase a wall-running puck that never crossed the center line", async () => {
    // 中央線での判断の機会が無い球 (自陣で奥壁に跳ね返って往復する) にも打ちに行く
    const r = await runTopAgent({ x: 24, y: 200, vx: 0, vy: -800 }, 300);
    expect(r.touched).toBe(true);
    expect(r.goal).not.toBe("GOAL_PLAYER");
  });

  it("should never concede an own goal while circling a slow puck near its net", async () => {
    // 打点がゴール寄りになる最悪の配置をいくつか試す
    for (const start of [
      { x: 300, y: 120, vx: 0, vy: 0 },
      { x: 250, y: 90, vx: 60, vy: -30 },
      { x: 360, y: 140, vx: -80, vy: 20 },
      { x: 300, y: 70, vx: 0, vy: -40 },
    ]) {
      const r = await runTopAgent(start, 260);
      expect(r.goal).not.toBe("GOAL_PLAYER");
    }
  });
});
