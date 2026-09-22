/**
 * Puck Trajectory Predictor Tests (Vitest)
 *
 * 予測が本物の物理とずれると、エージェントは「読んでいるのに当たらない」状態に
 * なる。壁反射を挟んでもサブピクセル精度で一致していることを固定する。
 */

import { describe, it, expect } from "vitest";
import { PhysicsEngine } from "../src/usecases/physicsEngine";
import { predictPuckPath, sampleAt, firstCrossing } from "../src/domain/puckPredictor";
import { DEFAULT_STADIUM_CONFIG as CFG } from "../src/domain/gameState";
import { Vec2 } from "../src/domain/physics";

/** マレットを隅へ退避させた状態で、実エンジンと予測を同じ時間だけ進める */
function compare(start: { x: number; y: number; vx: number; vy: number }, seconds: number) {
  const physics = new PhysicsEngine(CFG);
  const puck = physics.getPuck();
  puck.pos.set(start.x, start.y);
  puck.vel.set(start.vx, start.vy);
  physics.getJevMallet().pos.set(CFG.malletRadius, CFG.malletRadius);
  physics.getPlayerMallet().pos.set(CFG.malletRadius, CFG.height - CFG.malletRadius);

  const traj = predictPuckPath(new Vec2(start.x, start.y), new Vec2(start.vx, start.vy), CFG, {
    horizonSec: seconds + 0.2,
  });

  let goal: string | null = null;
  const steps = Math.round(seconds / CFG.fixedDt);
  for (let i = 0; i < steps; i++) {
    goal = physics.step(CFG.fixedDt);
    if (goal) break;
  }

  return { actual: puck.pos.clone(), predicted: sampleAt(traj, seconds)!, traj, goal };
}

describe("predictPuckPath", () => {
  it("should match the engine exactly while the puck travels freely", () => {
    const { actual, predicted } = compare({ x: 300, y: 450, vx: 0, vy: -800 }, 0.4);
    expect(predicted.pos.dist(actual)).toBeLessThan(0.5);
  });

  it("should match the engine across side wall bounces", () => {
    for (const start of [
      { x: 300, y: 450, vx: 600, vy: -500 },
      { x: 100, y: 700, vx: -700, vy: -600 },
      { x: 300, y: 450, vx: 900, vy: 200 },
    ]) {
      const { actual, predicted } = compare(start, 1.2);
      expect(predicted.pos.dist(actual)).toBeLessThan(1.5);
    }
  });

  it("should match the engine across a back wall bounce", () => {
    const { actual, predicted } = compare({ x: 450, y: 200, vx: 300, vy: -500 }, 0.6);
    expect(predicted.pos.dist(actual)).toBeLessThan(1.5);
  });

  it("should agree with the engine on which side concedes", () => {
    const { traj, goal } = compare({ x: 300, y: 300, vx: 0, vy: -700 }, 0.6);
    expect(goal).toBe("GOAL_PLAYER"); // 上のゴールへ入る = TOPの失点
    expect(traj.goalConcededBy).toBe("TOP");
    expect(traj.goalAt).toBeGreaterThan(0);
  });

  it("should treat a shot outside the goal mouth as a wall bounce, not a goal", () => {
    // ゴール開口部は 190〜410。その外側へ向かう球は奥壁で跳ね返る
    const traj = predictPuckPath(new Vec2(100, 300), new Vec2(0, -900), CFG, { horizonSec: 1.0 });
    expect(traj.goalConcededBy).toBeNull();
    expect(traj.bounceTimes.length).toBeGreaterThan(0);
  });

  it("should report where the puck crosses a given line", () => {
    const traj = predictPuckPath(new Vec2(300, 700), new Vec2(0, -900), CFG, { horizonSec: 1.0 });
    const crossing = firstCrossing(traj, 400, -1);
    expect(crossing).not.toBeNull();
    expect(crossing!.pos.y).toBeCloseTo(400, 0);
    expect(crossing!.t).toBeGreaterThan(0);
  });
});
