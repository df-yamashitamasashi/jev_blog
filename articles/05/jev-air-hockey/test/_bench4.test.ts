import { describe, it, expect } from "vitest";
import { solveContactNormal, solveIntercept, limitsFor, travelTime } from "../src/domain/interception";
import { predictPuckPath, puckVelocityAfterHit } from "../src/domain/puckPredictor";
import { DEFAULT_STADIUM_CONFIG as CFG } from "../src/domain/gameState";
import { Vec2 } from "../src/domain/physics";

describe("contact normal solver", () => {
  it("converges so the puck flies at the aim", () => {
    const cases: Array<[Vec2, Vec2, number]> = [
      [new Vec2(0, -900), new Vec2(0, 1), 900],      // 正面から来た球を真下へ打ち返す
      [new Vec2(500, -800), new Vec2(-1, 1), 900],   // 斜めの球を左下へ
      [new Vec2(-700, -400), new Vec2(0.3, 1), 700], // 横流れの強い球
      [new Vec2(0, 0), new Vec2(0, 1), 900],         // 静止球
      [new Vec2(200, 600), new Vec2(0, -1), 500],    // 逃げていく球を追い打ち
    ];
    for (const [pv, aim, sp] of cases) {
      const r = solveContactNormal(pv, aim, sp, CFG);
      const out = puckVelocityAfterHit(pv, r.normal.scale(sp), r.normal, CFG);
      const angErr = Math.abs(Math.atan2(out.normalize().cross(aim.normalize()), out.normalize().dot(aim.normalize())) * 180 / Math.PI);
      console.log(`puckV(${pv.x},${pv.y}) aim(${aim.x},${aim.y}) -> n(${r.normal.x.toFixed(3)},${r.normal.y.toFixed(3)}) out(${out.x|0},${out.y|0}) |out|=${out.mag()|0} err=${angErr.toFixed(3)}deg reported=${r.errorDeg.toFixed(3)}`);
      expect(angErr).toBeLessThan(0.5);
    }
  });
});

describe("intercept solver", () => {
  it("finds a strike for an incoming puck", () => {
    const traj = predictPuckPath(new Vec2(300, 700), new Vec2(0, -900), CFG, { horizonSec: 2 });
    const lim = limitsFor("TOP", CFG);
    const sol = solveIntercept(traj, new Vec2(300, 198), new Vec2(0,0), new Vec2(300, CFG.height), lim, CFG, { swingSpeed: CFG.maxMalletSpeed });
    console.log("SOL", JSON.stringify({ c: [sol!.contactPoint.x|0, sol!.contactPoint.y|0], t: sol!.contactTime.toFixed(3), slack: sol!.slackSec.toFixed(3), feasible: sol!.feasible, dir: [sol!.swingDir.x.toFixed(2), sol!.swingDir.y.toFixed(2)], pv: [sol!.predictedPuckVel.x|0, sol!.predictedPuckVel.y|0] }));
    expect(sol!.feasible).toBe(true);
  });
  it("travelTime sanity", () => {
    console.log("d=200 v0=0:", travelTime(200, 0, 900, 6000).toFixed(3));
    console.log("d=200 v0=-400:", travelTime(200, -400, 900, 6000).toFixed(3));
    console.log("d=400 v0=0:", travelTime(400, 0, 900, 6000).toFixed(3));
  });
});
