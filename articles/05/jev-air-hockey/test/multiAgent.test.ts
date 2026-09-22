/**
 * Multi-Agent Fairness & Decision Contract Tests (Vitest)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { AgentFactory } from "../src/adapters/agentFactory";
import { CpuAgentClient } from "../src/adapters/cpuAgentClient";
import { AirHockeyObservation } from "../src/adapters/agentClient";
import { AgentType } from "../src/domain/jevAgentTypes";
import { DEFAULT_STADIUM_CONFIG as CFG } from "../src/domain/gameState";
import { Vec2 } from "../src/domain/physics";
import { malletYRange } from "../src/domain/shotPlanValidator";
import { TournamentUseCase } from "../src/usecases/tournamentUseCase";

const storage: Record<string, string> = {};

beforeEach(() => {
  Object.keys(storage).forEach((k) => delete storage[k]);
  (globalThis as unknown as { window: unknown }).window = {};
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => storage[k] ?? null,
    setItem: (k: string, v: string) => {
      storage[k] = v;
    },
    removeItem: (k: string) => delete storage[k],
    clear: () => Object.keys(storage).forEach((k) => delete storage[k]),
  };
});

function observation(overrides: Partial<AirHockeyObservation> = {}): AirHockeyObservation {
  return {
    side: "TOP",
    puckPos: new Vec2(300, 500),
    puckVel: new Vec2(120, -700),
    myMalletPos: new Vec2(300, 150),
    myMalletVel: new Vec2(0, 0),
    opponentMalletPos: new Vec2(380, 760),
    opponentMalletVel: new Vec2(0, 0),
    myScore: 0,
    opponentScore: 0,
    config: CFG,
    ...overrides,
  };
}

describe("AgentFactory", () => {
  it("should create the right client for each agent type", () => {
    expect(AgentFactory.createClient(AgentType.CPU)?.type).toBe(AgentType.CPU);
    expect(AgentFactory.createClient(AgentType.JEV)?.type).toBe(AgentType.JEV);
    expect(AgentFactory.createClient(AgentType.GEMINI)?.type).toBe(AgentType.GEMINI);
    expect(AgentFactory.createClient(AgentType.CLAUDE)?.type).toBe(AgentType.CLAUDE);
    expect(AgentFactory.createClient(AgentType.HUMAN)).toBeNull();
  });

  it("should only mark CPU as usable when no API keys are set", () => {
    expect(AgentFactory.availableAgents()).toEqual([AgentType.CPU]);

    storage["claude_api_key"] = "sk-test";
    expect(AgentFactory.availableAgents()).toContain(AgentType.CLAUDE);
  });

  it("should mark only the CPU client as not using a live API", () => {
    expect(AgentFactory.createClient(AgentType.CPU)?.usesLiveApi).toBe(false);
    for (const type of [AgentType.JEV, AgentType.GEMINI, AgentType.CLAUDE]) {
      expect(AgentFactory.createClient(type)?.usesLiveApi).toBe(true);
    }
  });
});

describe("CpuAgentClient (benchmark control group)", () => {
  it("should return a plan that respects every physical guardrail", async () => {
    const telemetry = await new CpuAgentClient().decideShot(observation());

    expect(telemetry.status).toBe("OK");
    expect(telemetry.isLiveApi).toBe(false);

    const plan = telemetry.plan!;
    const [minY, maxY] = malletYRange("TOP", CFG);
    expect(plan.interceptPoint.y).toBeGreaterThanOrEqual(minY);
    expect(plan.interceptPoint.y).toBeLessThanOrEqual(maxY);
    expect(plan.swingSpeed).toBeLessThanOrEqual(CFG.maxMalletSpeed);
    expect(plan.swingDirDeg).toBeGreaterThanOrEqual(0);
    expect(plan.swingDirDeg).toBeLessThan(360);
  });

  it("should aim past the opponent goal line from either side", async () => {
    const cpu = new CpuAgentClient();

    // 狙い点はゴールラインではなくネットの奥。ライン上を狙うと、そこで
    // 止まる軌道が「ちょうど届く」と評価されてしまう
    const top = await cpu.decideShot(observation({ side: "TOP" }));
    expect(top.plan!.aimPoint.y).toBeGreaterThan(CFG.height);

    const bottom = await cpu.decideShot(
      observation({ side: "BOTTOM", puckVel: new Vec2(120, 700), myMalletPos: new Vec2(300, 750) })
    );
    expect(bottom.plan!.aimPoint.y).toBeLessThan(0);
  });

  it("should target the side away from the opponent mallet", async () => {
    const cpu = new CpuAgentClient();

    const opponentRight = await cpu.decideShot(
      observation({ opponentMalletPos: new Vec2(500, 760) })
    );
    const opponentLeft = await cpu.decideShot(
      observation({ opponentMalletPos: new Vec2(100, 760) })
    );

    expect(opponentRight.plan!.aimPoint.x).toBeLessThan(CFG.width * 0.5);
    expect(opponentLeft.plan!.aimPoint.x).toBeGreaterThan(CFG.width * 0.5);
  });
});

describe("TournamentUseCase scheduling", () => {
  it("should pair every agent exactly once per round", () => {
    const schedule = TournamentUseCase.buildSchedule({
      agents: [AgentType.CPU, AgentType.CLAUDE, AgentType.GEMINI, AgentType.JEV],
      matchesPerPairing: 1,
      targetScore: 3,
      maxRallies: 60,
    });

    expect(schedule).toHaveLength(6); // 4体の総当たり = 6ペア
  });

  it("should give each agent the top side equally when matches are even", () => {
    const schedule = TournamentUseCase.buildSchedule({
      agents: [AgentType.CPU, AgentType.CLAUDE],
      matchesPerPairing: 4,
      targetScore: 3,
      maxRallies: 60,
    });

    const cpuOnTop = schedule.filter((m) => m.top === AgentType.CPU).length;
    expect(cpuOnTop).toBe(2);
    expect(schedule).toHaveLength(4);
  });

  it("should give every match a distinct seed for reproducibility", () => {
    const schedule = TournamentUseCase.buildSchedule({
      agents: [AgentType.CPU, AgentType.CLAUDE, AgentType.GEMINI],
      matchesPerPairing: 2,
      targetScore: 3,
      maxRallies: 60,
    });

    expect(new Set(schedule.map((m) => m.seed)).size).toBe(schedule.length);
  });
});
