import { describe, it } from "vitest";
import { PhysicsEngine } from "../src/usecases/physicsEngine";
import { AgentBrainUseCase } from "../src/usecases/agentBrainUseCase";
import { CpuAgentClient } from "../src/adapters/cpuAgentClient";
import { AgentType } from "../src/domain/jevAgentTypes";
import { DEFAULT_STADIUM_CONFIG as CFG } from "../src/domain/gameState";

// TOP側エージェント単体を、決め打ちの盤面から動かして挙動を観察する
async function scenario(name: string, puck: {x:number;y:number;vx:number;vy:number}, steps = 220) {
  const physics = new PhysicsEngine(CFG);
  const brain = new AgentBrainUseCase(new CpuAgentClient(), CFG, "TOP", AgentType.CPU);
  const p = physics.getPuck();
  p.pos.set(puck.x, puck.y);
  p.vel.set(puck.vx, puck.vy);
  const m = physics.getJevMallet();
  m.pos.set(CFG.width * 0.5, CFG.height * 0.22);
  m.vel.set(0, 0);

  let touched = false;
  let goal: string | null = null;
  const log: string[] = [];

  for (let i = 0; i < steps; i++) {
    const o = brain.observe(p);
    if (o.needsDecision) {
      await brain.requestDecision(p, m, physics.getPlayerMallet(), 0, 0);
    }
    brain.stepServo(CFG.fixedDt, m, p);
    const g = physics.step(CFG.fixedDt, (e) => {
      if (e.type === "PUCK_MALLET_JEV") touched = true;
    });
    if (g) { goal = g; break; }
    if (i % 30 === 0) {
      log.push(`t=${(i*CFG.fixedDt).toFixed(2)} puck(${p.pos.x|0},${p.pos.y|0}) v(${p.vel.x|0},${p.vel.y|0}) mallet(${m.pos.x|0},${m.pos.y|0}) mv(${m.vel.x|0},${m.vel.y|0})`);
    }
  }
  console.log(`### ${name}: touched=${touched} goal=${goal} finalPuck=(${p.pos.x|0},${p.pos.y|0}) v=(${p.vel.x|0},${p.vel.y|0}) speed=${p.vel.mag()|0}`);
  log.forEach(l => console.log("   " + l));
}

describe("bench2", () => {
  it("scenarios", async () => {
    await scenario("A: 正面から速球", { x: 300, y: 700, vx: 0, vy: -900 });
    await scenario("B: 鋭い角度から", { x: 80, y: 700, vx: 520, vy: -820 });
    await scenario("C: 自陣で停止したパック", { x: 300, y: 150, vx: 0, vy: 0 }, 300);
    await scenario("D: 自陣を横切るパック(vy≈0)", { x: 60, y: 200, vx: 420, vy: 5 }, 300);
    await scenario("E: ゆっくり戻ってくる", { x: 300, y: 500, vx: 0, vy: -90 }, 400);
    await scenario("F: 壁跳ね返り狙い", { x: 520, y: 640, vx: 420, vy: -700 });
  }, 120000);
});
