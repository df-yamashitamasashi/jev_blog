import { describe, it } from "vitest";
import { GameLoopUseCase } from "../src/usecases/gameLoopUseCase";
import { PhysicsEngine } from "../src/usecases/physicsEngine";
import { AgentBrainUseCase } from "../src/usecases/agentBrainUseCase";
import { CpuAgentClient } from "../src/adapters/cpuAgentClient";
import { AgentType } from "../src/domain/jevAgentTypes";
import { DEFAULT_STADIUM_CONFIG as CFG } from "../src/domain/gameState";
import { ISoundSynthesizer } from "../src/adapters/soundSynthesizer";

class SilentSound implements ISoundSynthesizer {
  playHitPuck = () => {};
  playWallBounce = () => {};
  playSmashHit = () => {};
  playGoal = () => {};
  playCountDown = () => {};
  toggleBgm = () => {};
  isBgmActive = () => false;
}

describe("bench", () => {
  it("cpu vs cpu", async () => {
    const physics = new PhysicsEngine(CFG);
    const topBrain = new AgentBrainUseCase(new CpuAgentClient(), CFG, "TOP", AgentType.CPU);
    const loop = new GameLoopUseCase(physics, topBrain, new SilentSound(), CFG, AgentType.CPU, AgentType.CPU);
    loop.setFairTiming(true);
    loop.startMatch(7, 99, 400);

    for (let i = 0; i < 4000 && !loop.isFinished(); i++) await loop.advance(60);

    const s = loop.getStats();
    const st = loop.getMatchState();
    const fmt = (x: typeof s.top) => ({
      saves: x.saves, whiffs: x.whiffs,
      saveRate: (100 * x.saves / Math.max(1, x.saves + x.whiffs)).toFixed(1) + "%",
      goalsFor: x.goalsFor, goalsAgainst: x.goalsAgainst,
      decisions: x.decisions, clamped: x.clamped,
      aimErr: (x.aimErrorSumDeg / Math.max(1, x.aimErrorSamples)).toFixed(1) + "deg",
      aimSamples: x.aimErrorSamples,
    });
    console.log("FINISHED:", loop.isFinished(), "score", st.score.jev, "-", st.score.player,
      "rallies", st.rallyCount, "dur", st.matchDurationSec.toFixed(1) + "s",
      "maxSpeed", st.maxSpeedReached);
    console.log("TOP   ", JSON.stringify(fmt(s.top)));
    console.log("BOTTOM", JSON.stringify(fmt(s.bottom)));
  }, 120000);
});
