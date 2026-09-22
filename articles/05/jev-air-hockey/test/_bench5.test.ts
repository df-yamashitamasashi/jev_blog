import { describe, it } from "vitest";
import { PhysicsEngine } from "../src/usecases/physicsEngine";
import { AgentBrainUseCase } from "../src/usecases/agentBrainUseCase";
import { CpuAgentClient } from "../src/adapters/cpuAgentClient";
import { AgentType } from "../src/domain/jevAgentTypes";
import { DEFAULT_STADIUM_CONFIG as CFG } from "../src/domain/gameState";

describe("trace C", () => {
  it("stationary puck in own half", async () => {
    const physics = new PhysicsEngine(CFG);
    const brain = new AgentBrainUseCase(new CpuAgentClient(), CFG, "TOP", AgentType.CPU);
    const p = physics.getPuck(); p.pos.set(300, 143); p.vel.set(0, 0);
    const m = physics.getJevMallet(); m.pos.set(300, 198); m.vel.set(0,0);
    physics.getPlayerMallet().pos.set(300, 800);

    for (let i = 0; i < 90; i++) {
      const o = brain.observe(p);
      if (o.needsDecision) await brain.requestDecision(p, m, physics.getPlayerMallet(), 0, 0);
      brain.stepServo(CFG.fixedDt, m, p);
      const g = physics.step(CFG.fixedDt);
      if (i % 6 === 0 || g) {
        const sol = brain.getSolution();
        const pl = brain.getPlan();
        console.log(`i=${i} mode=${brain.getMode()} puck(${p.pos.x|0},${p.pos.y|0}) v(${p.vel.x|0},${p.vel.y|0}) mallet(${m.pos.x|0},${m.pos.y|0}) mv(${m.vel.x|0},${m.vel.y|0})`
          + (sol ? ` C=(${sol.contactPoint.x|0},${sol.contactPoint.y|0}) t=${sol.contactTime.toFixed(2)} dir=(${sol.swingDir.x.toFixed(2)},${sol.swingDir.y.toFixed(2)})` : " nosol")
          + (pl ? ` aim=(${pl.aimPoint.x|0},${pl.aimPoint.y|0}) ip=(${pl.interceptPoint.x|0},${pl.interceptPoint.y|0})` : " noplan"));
      }
      if (g) { console.log("GOAL", g); break; }
    }
  });
});
