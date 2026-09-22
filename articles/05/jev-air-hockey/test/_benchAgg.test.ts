import { describe, it } from "vitest";
import { GameLoopUseCase } from "../src/usecases/gameLoopUseCase";
import { PhysicsEngine } from "../src/usecases/physicsEngine";
import { AgentBrainUseCase } from "../src/usecases/agentBrainUseCase";
import { CpuAgentClient } from "../src/adapters/cpuAgentClient";
import { AgentType } from "../src/domain/jevAgentTypes";
import { DEFAULT_STADIUM_CONFIG, StadiumConfig } from "../src/domain/gameState";
import { ISoundSynthesizer } from "../src/adapters/soundSynthesizer";

class SilentSound implements ISoundSynthesizer {
  playHitPuck = () => {}; playWallBounce = () => {}; playSmashHit = () => {};
  playGoal = () => {}; playCountDown = () => {}; toggleBgm = () => {}; isBgmActive = () => false;
}

const CFG: StadiumConfig = {
  ...DEFAULT_STADIUM_CONFIG,
  ...(process.env.ACCEL ? { maxMalletAccel: Number(process.env.ACCEL) } : {}),
  ...(process.env.MSPEED ? { maxMalletSpeed: Number(process.env.MSPEED) } : {}),
};

async function match(seed: number) {
  const physics = new PhysicsEngine(CFG);
  const topBrain = new AgentBrainUseCase(new CpuAgentClient(), CFG, "TOP", AgentType.CPU);
  const loop = new GameLoopUseCase(physics, topBrain, new SilentSound(), CFG, AgentType.CPU, AgentType.CPU);
  loop.setFairTiming(true);
  loop.startMatch(7, seed, 600);
  for (let i = 0; i < 9000 && !loop.isFinished(); i++) await loop.advance(60);
  const s = loop.getStats(); const st = loop.getMatchState();
  return { st, s };
}

describe("aggregate", () => {
  it("cpu self-play over seeds", async () => {
    const seeds = [1, 7, 42, 99, 2024, 31337];
    let goals = 0, dur = 0, rallies = 0, saves = 0, whiffs = 0, aimSum = 0, aimN = 0, maxSpeed = 0, topGoals = 0, botGoals = 0;
    for (const seed of seeds) {
      const { st, s } = await match(seed);
      goals += st.score.jev + st.score.player;
      topGoals += st.score.jev; botGoals += st.score.player;
      dur += st.matchDurationSec; rallies += st.rallyCount;
      maxSpeed = Math.max(maxSpeed, st.maxSpeedReached);
      for (const x of [s.top, s.bottom]) {
        saves += x.saves; whiffs += x.whiffs; aimSum += x.aimErrorSumDeg; aimN += x.aimErrorSamples;
      }
      console.log(`seed ${seed}: ${st.score.jev}-${st.score.player} in ${st.matchDurationSec.toFixed(1)}s rallies=${st.rallyCount} maxV=${st.maxSpeedReached}`);
    }
    console.log(`=== accel=${CFG.maxMalletAccel} mspeed=${CFG.maxMalletSpeed}`);
    console.log(`goals=${goals} (top ${topGoals} / bottom ${botGoals}) totalDur=${dur.toFixed(0)}s goalsPerMin=${(goals/dur*60).toFixed(2)}`);
    console.log(`rallies=${rallies} saveRate=${(100*saves/(saves+whiffs)).toFixed(1)}% avgAimErr=${(aimSum/Math.max(1,aimN)).toFixed(1)}deg maxPuck=${maxSpeed}`);
  }, 600000);
});
