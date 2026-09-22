/**
 * Interception Solver Tests (Vitest)
 *
 * 「狙った座標へ飛ばすための接触位置」を解く部分の正しさを固定する。
 * ここが狂うと、戦術が完璧でも打球は別の方向へ飛ぶ。
 */

import { describe, it, expect } from "vitest";
import {
  limitsFor,
  solveContactNormal,
  solveIntercept,
  solveBlockPoint,
  travelTime,
} from "../src/domain/interception";
import { predictPuckPath, puckVelocityAfterHit } from "../src/domain/puckPredictor";
import { DEFAULT_STADIUM_CONFIG as CFG } from "../src/domain/gameState";
import { Vec2 } from "../src/domain/physics";

/** 2ベクトルのなす角 (度, 0-180) */
function angleBetween(a: Vec2, b: Vec2): number {
  const ua = a.normalize();
  const ub = b.normalize();
  return (Math.acos(Math.max(-1, Math.min(1, ua.dot(ub)))) * 180) / Math.PI;
}

describe("travelTime", () => {
  it("should grow with distance and shrink with a head start", () => {
    const far = travelTime(400, 0, 1050, 12000);
    const near = travelTime(100, 0, 1050, 12000);
    expect(far).toBeGreaterThan(near);

    const movingToward = travelTime(400, 600, 1050, 12000);
    const movingAway = travelTime(400, -600, 1050, 12000);
    expect(movingToward).toBeLessThan(far);
    expect(movingAway).toBeGreaterThan(far);
  });

  it("should never exceed the constant-speed bound by much", () => {
    // 加速が必要なぶん等速より遅いが、桁が違うことはない
    const t = travelTime(300, 0, 1050, 12000);
    expect(t).toBeGreaterThan(300 / 1050);
    expect(t).toBeLessThan((300 / 1050) * 3);
  });
});

describe("solveContactNormal", () => {
  it("should send the puck exactly at the requested direction", () => {
    const cases: Array<[Vec2, Vec2, number]> = [
      [new Vec2(0, -900), new Vec2(0, 1), 900],
      [new Vec2(500, -800), new Vec2(-1, 1), 900],
      [new Vec2(-700, -400), new Vec2(0.3, 1), 700],
      [new Vec2(0, 0), new Vec2(0, 1), 900],
      [new Vec2(200, 600), new Vec2(0, -1), 500],
    ];

    for (const [puckVel, aimDir, swingSpeed] of cases) {
      const solved = solveContactNormal(puckVel, aimDir, swingSpeed, CFG);
      const outgoing = puckVelocityAfterHit(puckVel, solved.normal.scale(swingSpeed), solved.normal, CFG);
      expect(angleBetween(outgoing, aimDir)).toBeLessThan(0.5);
    }
  });

  it("should account for the incoming momentum, not just point at the aim", () => {
    // 横流れの強い球では、素直に狙いへ法線を向けるだけでは横にずれる
    const puckVel = new Vec2(800, -600);
    const aim = new Vec2(0, 1);
    const naive = puckVelocityAfterHit(puckVel, aim.scale(900), aim.normalize(), CFG);
    const solved = solveContactNormal(puckVel, aim, 900, CFG);

    expect(angleBetween(naive, aim)).toBeGreaterThan(5);
    expect(solved.errorDeg).toBeLessThan(0.5);
  });
});

describe("solveIntercept", () => {
  it("should place the mallet behind the puck relative to the aim", () => {
    const traj = predictPuckPath(new Vec2(300, 700), new Vec2(0, -900), CFG, { horizonSec: 2 });
    const limits = limitsFor("TOP", CFG);
    const aim = new Vec2(300, CFG.height + 30);

    const sol = solveIntercept(traj, new Vec2(300, 198), new Vec2(0, 0), aim, limits, CFG, {
      swingSpeed: CFG.maxMalletSpeed,
    })!;

    expect(sol.feasible).toBe(true);

    // 接触法線 = マレット中心 → パック中心 が狙い方向を向いている
    const normal = sol.puckPosAtContact.sub(sol.contactPoint).normalize();
    expect(angleBetween(normal, aim.sub(sol.puckPosAtContact))).toBeLessThan(2);

    // 打点は必ず自陣内
    expect(sol.contactPoint.y).toBeGreaterThanOrEqual(limits.minY);
    expect(sol.contactPoint.y).toBeLessThanOrEqual(limits.maxY);

    // 宣言どおりの速度で飛ぶ見込みが立っている
    expect(sol.predictedPuckVel.mag()).toBeGreaterThan(900);
  });

  it("should return the closest attempt instead of nothing when it cannot get there in time", () => {
    // 逆サイドから超高速の球。間に合わないが、諦めて止まってはいけない
    const traj = predictPuckPath(new Vec2(300, 500), new Vec2(0, -2000), CFG, { horizonSec: 2 });
    const limits = limitsFor("TOP", CFG);

    const sol = solveIntercept(traj, new Vec2(40, 430), new Vec2(0, 0), new Vec2(300, CFG.height + 30), limits, CFG, {
      swingSpeed: CFG.maxMalletSpeed,
    });

    expect(sol).not.toBeNull();
    expect(sol!.feasible).toBe(false);
    expect(sol!.slackSec).toBeLessThan(0);
  });

  it("should report no solution when the aim would need the mallet outside the court", () => {
    // 右端の壁沿いを駆け上がる球をゴール中央へ返すには、マレットをコート外の
    // 右上に置く必要がある。ここで無理な解を返すより、守備 (solveBlockPoint) に
    // 切り替えられるよう null を返す方が正しい
    const traj = predictPuckPath(new Vec2(CFG.width - CFG.puckRadius, 500), new Vec2(0, -2000), CFG, {
      horizonSec: 2,
    });
    const limits = limitsFor("TOP", CFG);

    const sol = solveIntercept(traj, new Vec2(40, 430), new Vec2(0, 0), new Vec2(300, CFG.height + 30), limits, CFG, {
      swingSpeed: CFG.maxMalletSpeed,
    });

    expect(sol).toBeNull();
  });

  it("should honour a declared intercept point among equally timed strikes", () => {
    // 迎撃点の宣言は戦術 (早く当てるか、深く待つか) なので、解が並んだときは
    // 宣言に寄せる。ただし大きく遅らせる打点までは選ばない
    const traj = predictPuckPath(new Vec2(300, 620), new Vec2(0, -500), CFG, { horizonSec: 2 });
    const limits = limitsFor("TOP", CFG);
    const aim = new Vec2(300, CFG.height + 30);
    const opts = { swingSpeed: CFG.maxMalletSpeed };

    const deep = solveIntercept(traj, new Vec2(300, 198), new Vec2(0, 0), aim, limits, CFG, {
      ...opts,
      preferPoint: new Vec2(300, limits.minY),
    })!;
    const shallow = solveIntercept(traj, new Vec2(300, 198), new Vec2(0, 0), aim, limits, CFG, {
      ...opts,
      preferPoint: new Vec2(300, limits.maxY),
    })!;

    expect(deep.contactPoint.y).toBeLessThanOrEqual(shallow.contactPoint.y);
    // どちらも自陣内の実行可能な打点であること
    for (const sol of [deep, shallow]) {
      expect(sol.feasible).toBe(true);
      expect(sol.contactPoint.y).toBeGreaterThanOrEqual(limits.minY);
      expect(sol.contactPoint.y).toBeLessThanOrEqual(limits.maxY);
    }
  });
});

describe("solveBlockPoint", () => {
  it("should stand between the threat and the goal, inside the posts", () => {
    const traj = predictPuckPath(new Vec2(250, 500), new Vec2(-200, -1800), CFG, { horizonSec: 1 });
    const limits = limitsFor("TOP", CFG);
    const block = solveBlockPoint(traj, "TOP", limits, CFG);

    expect(block.y).toBeGreaterThanOrEqual(limits.minY);
    expect(block.y).toBeLessThanOrEqual(limits.maxY);

    const postMargin = CFG.goalWidth * 0.5 + CFG.malletRadius;
    expect(Math.abs(block.x - CFG.width * 0.5)).toBeLessThanOrEqual(postMargin + 0.001);
  });
});
