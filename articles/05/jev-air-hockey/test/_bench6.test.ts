import { describe, it } from "vitest";
import { PhysicsEngine } from "../src/usecases/physicsEngine";
import { AgentBrainUseCase } from "../src/usecases/agentBrainUseCase";
import { CpuAgentClient } from "../src/adapters/cpuAgentClient";
import { AgentType } from "../src/domain/jevAgentTypes";
import { DEFAULT_STADIUM_CONFIG as CFG } from "../src/domain/gameState";
import { Vec2 } from "../src/domain/physics";

const ang = (a: Vec2, b: Vec2) => Math.abs(Math.atan2(a.normalize().cross(b.normalize()), a.normalize().dot(b.normalize())) * 180 / Math.PI);

describe("contact quality", () => {
  it("measures aim realisation at each hit", async () => {
    const physics = new PhysicsEngine(CFG);
    const top = new AgentBrainUseCase(new CpuAgentClient(), CFG, "TOP", AgentType.CPU);
    const bot = new AgentBrainUseCase(new CpuAgentClient(), CFG, "BOTTOM", AgentType.CPU);
    const puck = physics.getPuck();
    const tm = physics.getJevMallet(), bm = physics.getPlayerMallet();
    physics.resetPositions("PLAYER");

    let hits = 0;
    const errs: number[] = [];
    const posErrs: number[] = [];
    const speeds: number[] = [];

    for (let i = 0; i < 12000 && hits < 30; i++) {
      for (const [b, m, o] of [[top, tm, bm], [bot, bm, tm]] as const) {
        const ob = b.observe(puck);
        if (ob.needsDecision) await b.requestDecision(puck, m, o, 0, 0);
      }
      top.stepServo(CFG.fixedDt, tm, puck);
      bot.stepServo(CFG.fixedDt, bm, puck);

      const preTop = { pos: tm.pos.clone(), vel: tm.vel.clone(), sol: top.getSolution(), plan: top.getPlan(), mode: top.getMode(), committed: (top as any).commitment ? true : false, tau: (top as any).commitment?.timeLeft };
      const g = physics.step(CFG.fixedDt, (e) => {
        if (e.type !== "PUCK_MALLET_JEV") return;
        hits++;
        const plan = preTop.plan, sol = preTop.sol;
        if (!plan) { console.log(`hit#${hits} NOPLAN mode=${preTop.mode}`); return; }
        const intended = plan.aimPoint.sub(puck.pos);
        const e2 = ang(intended, puck.vel);
        errs.push(e2);
        speeds.push(puck.vel.mag());
        const pe = sol ? preTop.pos.dist(sol.contactPoint) : NaN;
        if (!Number.isNaN(pe)) posErrs.push(pe);
        console.log(`hit#${hits} ${preTop.mode} committed=${preTop.committed} tau=${preTop.tau?.toFixed(3)} aimErr=${e2.toFixed(1)}deg out=${puck.vel.mag()|0} mvel=${preTop.vel.mag()|0} posErr=${pe.toFixed(1)}px feas=${sol?.feasible}`);
      });
      if (g) physics.resetPositions(g === "GOAL_PLAYER" ? "JEV" : "PLAYER");
    }
    const avg = (a: number[]) => (a.reduce((x,y)=>x+y,0)/Math.max(1,a.length));
    console.log(`SUMMARY hits=${hits} avgAimErr=${avg(errs).toFixed(1)}deg avgPosErr=${avg(posErrs).toFixed(1)}px avgSpeed=${avg(speeds)|0}`);
  }, 60000);
});
