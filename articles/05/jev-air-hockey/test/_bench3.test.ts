import { describe, it } from "vitest";
import { PhysicsEngine } from "../src/usecases/physicsEngine";
import { predictPuckPath, sampleAt } from "../src/domain/puckPredictor";
import { DEFAULT_STADIUM_CONFIG as CFG } from "../src/domain/gameState";
import { Vec2 } from "../src/domain/physics";

function drift(p: {x:number;y:number;vx:number;vy:number}, sec: number) {
  const physics = new PhysicsEngine(CFG);
  const puck = physics.getPuck();
  puck.pos.set(p.x, p.y); puck.vel.set(p.vx, p.vy);
  // マレットを邪魔にならない位置へ
  physics.getPlayerMallet().pos.set(34, 866);
  physics.getJevMallet().pos.set(34, 34);

  const traj = predictPuckPath(new Vec2(p.x, p.y), new Vec2(p.vx, p.vy), CFG, { horizonSec: sec + 0.1 });
  const steps = Math.round(sec / CFG.fixedDt);
  let goal = null;
  for (let i = 0; i < steps; i++) { goal = physics.step(CFG.fixedDt); if (goal) break; }
  const pred = sampleAt(traj, sec)!;
  const err = Math.hypot(pred.pos.x - puck.pos.x, pred.pos.y - puck.pos.y);
  console.log(`start(${p.x},${p.y}) v(${p.vx},${p.vy}) t=${sec}s -> actual(${puck.pos.x.toFixed(1)},${puck.pos.y.toFixed(1)}) pred(${pred.pos.x.toFixed(1)},${pred.pos.y.toFixed(1)}) ERR=${err.toFixed(2)}px goal=${goal} predGoal=${traj.goalConcededBy}@${traj.goalAt?.toFixed(2)}`);
}

describe("predictor accuracy", () => {
  it("matches engine", () => {
    drift({x:300,y:450,vx:0,vy:-800}, 0.4);
    drift({x:300,y:450,vx:600,vy:-500}, 0.8);
    drift({x:100,y:700,vx:-700,vy:-600}, 1.2);
    drift({x:300,y:450,vx:900,vy:200}, 1.5);
    drift({x:450,y:200,vx:300,vy:-500}, 0.6);   // 奥壁反射
    drift({x:300,y:300,vx:0,vy:-700}, 0.6);     // ゴールへ
  });
});
