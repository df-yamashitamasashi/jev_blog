/**
 * Game Match State & Loop Unit Tests (Vitest)
 */

import { describe, it, expect } from "vitest";
import { GameLoopUseCase } from "../src/usecases/gameLoopUseCase";
import { PhysicsEngine } from "../src/usecases/physicsEngine";
import { AgentBrainUseCase } from "../src/usecases/agentBrainUseCase";
import { CpuAgentClient } from "../src/adapters/cpuAgentClient";
import { DEFAULT_STADIUM_CONFIG, GameStatus } from "../src/domain/gameState";
import { AgentType } from "../src/domain/jevAgentTypes";
import { ISoundSynthesizer } from "../src/adapters/soundSynthesizer";

class MockSoundSynthesizer implements ISoundSynthesizer {
  playHitPuck = () => {};
  playWallBounce = () => {};
  playSmashHit = () => {};
  playGoal = () => {};
  playCountDown = () => {};
  toggleBgm = () => {};
  isBgmActive = () => false;
}

const config = DEFAULT_STADIUM_CONFIG;

function makeLoop(): GameLoopUseCase {
  const physics = new PhysicsEngine(config);
  const brain = new AgentBrainUseCase(new CpuAgentClient(), config, "TOP", AgentType.CPU);
  return new GameLoopUseCase(
    physics,
    brain,
    new MockSoundSynthesizer(),
    config,
    AgentType.CPU,
    AgentType.CPU
  );
}

describe("GameLoopUseCase", () => {
  it("should initialize with READY state and 0-0 score", () => {
    const state = makeLoop().getMatchState();
    expect(state.status).toBe(GameStatus.READY);
    expect(state.score.player).toBe(0);
    expect(state.score.jev).toBe(0);
  });

  it("should transition to PLAYING on startMatch", () => {
    const loop = makeLoop();
    loop.startMatch();
    expect(loop.getMatchState().status).toBe(GameStatus.PLAYING);
  });

  it("should pause and resume properly", () => {
    const loop = makeLoop();
    loop.startMatch();
    loop.pauseMatch();
    expect(loop.getMatchState().status).toBe(GameStatus.PAUSED);
    loop.pauseMatch();
    expect(loop.getMatchState().status).toBe(GameStatus.PLAYING);
  });

  it("should run a CPU vs CPU match to completion without any API call", async () => {
    const loop = makeLoop();
    loop.startMatch(2, 42, 40);

    // 固定ステップなので実時間に依存せず決着する
    for (let i = 0; i < 400 && !loop.isFinished(); i++) {
      await loop.advance(120);
    }

    expect(loop.isFinished()).toBe(true);

    const { top, bottom } = loop.getStats();
    expect(top.apiCalls).toBe(0);
    expect(bottom.apiCalls).toBe(0);
    expect(top.decisions).toBeGreaterThan(0);
    expect(top.matches + bottom.matches).toBe(2);
  });

  it("should be reproducible for the same seed", async () => {
    const run = async () => {
      const loop = makeLoop();
      loop.startMatch(2, 7, 30);
      for (let i = 0; i < 400 && !loop.isFinished(); i++) {
        await loop.advance(120);
      }
      const s = loop.getMatchState();
      return `${s.score.jev}-${s.score.player}/${s.rallyCount}`;
    };

    expect(await run()).toBe(await run());
  });

  it("should never exceed the physical puck speed ceiling during a full match", async () => {
    const loop = makeLoop();
    loop.startMatch(3, 99, 60);

    for (let i = 0; i < 400 && !loop.isFinished(); i++) {
      await loop.advance(120);
    }

    expect(loop.getMatchState().maxSpeedReached).toBeLessThanOrEqual(config.maxPuckSpeed);
  });
});
