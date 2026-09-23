/**
 * Playbook (作戦) Tests (Vitest)
 *
 * 作戦タイムに立てた作戦が、局面の分類 → 打ち方の当てはめまで正しく流れることを固定する。
 */

import { describe, it, expect } from "vitest";
import { Vec2 } from "../src/domain/physics";
import { DEFAULT_STADIUM_CONFIG as CFG } from "../src/domain/gameState";
import { predictPuckPath } from "../src/domain/puckPredictor";
import { limitsFor } from "../src/domain/interception";
import {
  INCOMING_SITUATIONS,
  LINGERING_SITUATIONS,
  PlaybookMove,
  classifyIncoming,
  classifyLingering,
  moveToPlan,
  validatePlaybook,
  countMoves,
  CPU_STYLES,
} from "../src/domain/playbook";
import {
  PLAYBOOK_CHOICE_SCHEMA,
  buildPlaybookPrompt,
  buildShotCall,
  playbookTelemetryFromChoices,
  shotTelemetryFromChoices,
} from "../src/adapters/llmChoiceProtocol";
import { SITUATION_QUESTIONS, buildShotQuestions } from "../src/adapters/choiceQuestions";
import { CpuAgentClient } from "../src/adapters/cpuAgentClient";
import { buildPlaybookQuestions, answersToRawPlaybook } from "../src/adapters/choiceQuestions";

const traj = (x: number, y: number, vx: number, vy: number) =>
  predictPuckPath(new Vec2(x, y), new Vec2(vx, vy), CFG, { horizonSec: 2 });

describe("classifyIncoming", () => {
  it.each([
    [300, 445, 0, -1500, "THREAT_FAST"],
    [300, 445, 0, -600, "THREAT_SLOW"],
    [150, 445, -900, -500, "BANK_FROM_LEFT"],
    [450, 445, 900, -500, "BANK_FROM_RIGHT"],
    [80, 445, 0, -1500, "FAST_LEFT"],
    [380, 445, 350, -1250, "FAST_CENTER"],
    [520, 445, 0, -1500, "FAST_RIGHT"],
    [80, 445, 0, -600, "SLOW_LEFT"],
    [390, 445, 120, -600, "SLOW_CENTER"],
    [520, 445, 0, -600, "SLOW_RIGHT"],
  ])("puck (%i,%i) vel (%i,%i) → %s", (x, y, vx, vy, expected) => {
    expect(classifyIncoming(traj(x, y, vx, vy), new Vec2(vx, vy), "TOP", CFG)).toBe(expected);
  });
});

describe("classifyLingering", () => {
  it.each([
    [300, 300, 0, -300, "ROLLING_TO_GOAL"],
    [300, 100, 40, 10, "NEAR_GOAL"],
    [60, 100, 0, 0, "CORNER_LEFT"],
    [540, 100, 0, 0, "CORNER_RIGHT"],
    [60, 300, 10, 0, "STOPPED_LEFT"],
    [300, 300, 10, 0, "STOPPED_CENTER"],
    [540, 300, 0, 10, "STOPPED_RIGHT"],
    [30, 300, 0, 400, "WALL_SHUTTLE_LEFT"],
    [570, 300, 0, -400, "WALL_SHUTTLE_RIGHT"],
    [300, 300, 300, 100, "MOVING_OPEN"],
  ])("puck (%i,%i) vel (%i,%i) → %s", (x, y, vx, vy, expected) => {
    expect(classifyLingering(traj(x, y, vx, vy), new Vec2(x, y), new Vec2(vx, vy), "TOP", CFG)).toBe(expected);
  });
});

describe("moveToPlan", () => {
  const limits = limitsFor("TOP", CFG);
  const mallet = new Vec2(300, 150);
  const opponent = new Vec2(300, 760);
  const base: PlaybookMove = { strikeTiming: "DIRECT", depth: "EARLY", aim: "GOAL_CENTER", path: "STRAIGHT", moveSpeed: 1050, swingSpeed: 1050 };

  it("should hit after the wall bounce when the move says REBOUND", () => {
    const t = traj(150, 445, -900, -500);
    const bounce = t.bounceTimes[0];

    const direct = moveToPlan(base, t, mallet, "TOP", limits, CFG, opponent, "X")!;
    const rebound = moveToPlan({ ...base, strikeTiming: "REBOUND" }, t, mallet, "TOP", limits, CFG, opponent, "X")!;

    expect(direct.contactTimeMs / 1000).toBeLessThan(bounce);
    expect(rebound.contactTimeMs / 1000).toBeGreaterThan(bounce);
    expect(rebound.strikeTiming).toBe("REBOUND");
  });

  it("should wait longer for a LATE move than an EARLY one", () => {
    const t = traj(300, 445, 0, -500);
    const early = moveToPlan(base, t, mallet, "TOP", limits, CFG, opponent, "X")!;
    const late = moveToPlan({ ...base, depth: "LATE" }, t, mallet, "TOP", limits, CFG, opponent, "X")!;
    expect(late.contactTimeMs).toBeGreaterThan(early.contactTimeMs + 200);
  });

  it("should place the mallet behind the puck, opposite the aim", () => {
    const t = traj(300, 300, 0, 0);
    const plan = moveToPlan({ ...base, aim: "GOAL_LEFT" }, t, mallet, "TOP", limits, CFG, opponent, "X")!;
    const puckAtContact = t.samples[Math.round(plan.contactTimeMs / 1000 / t.dt)].pos;
    const toPuck = puckAtContact.sub(plan.interceptPoint);
    expect(toPuck.mag()).toBeCloseTo(CFG.puckRadius + CFG.malletRadius, 0);
    expect(toPuck.normalize().dot(plan.aimPoint.sub(puckAtContact).normalize())).toBeGreaterThan(0.999);
  });
});

describe("validatePlaybook", () => {
  it("should accept the CPU playbook with all 20 situations", async () => {
    const t = await new CpuAgentClient().decidePlaybook({ side: "TOP", config: CFG, targetScore: 7 });
    expect(t.status).toBe("OK");
    expect(countMoves(t.playbook!)).toBe(INCOMING_SITUATIONS.length + LINGERING_SITUATIONS.length);
  });

  /** 20局面すべてが揃った作戦の生データ */
  function fullRaw(overrides: Record<string, unknown> = {}) {
    const m = { strikeTiming: "DIRECT", depth: "EARLY", aim: "CLEAR", path: "STRAIGHT", moveSpeed: 900, swingSpeed: 900 };
    return {
      readyPosition: { x: 300, y: 150 },
      cpuStyle: "BALANCED",
      incoming: Object.fromEntries(INCOMING_SITUATIONS.map((k) => [k, { ...m }])),
      lingering: Object.fromEntries(LINGERING_SITUATIONS.map((k) => [k, { ...m }])),
      ...overrides,
    };
  }

  it("should accept a complete playbook", () => {
    const { playbook, issues } = validatePlaybook(fullRaw(), "TOP", CFG);
    expect(issues).toEqual([]);
    expect(countMoves(playbook!)).toBe(20);
  });

  it("should reject a playbook with a missing situation, and say which one", () => {
    const raw = fullRaw();
    delete (raw.incoming as Record<string, unknown>).THREAT_SLOW;
    const { playbook, issues } = validatePlaybook(raw, "TOP", CFG);
    // 欠けた局面をローカルで補ったり、欠けたまま受け付けたりしない
    expect(playbook).toBeNull();
    expect(issues).toEqual(["incoming.THREAT_SLOW が無い"]);
  });

  it.each([
    ["選択肢に無い値", (r: any) => (r.lingering.CORNER_LEFT.aim = "SOMEWHERE"), "lingering.CORNER_LEFT.aim が選択肢に無い"],
    ["項目の欠落", (r: any) => delete r.incoming.FAST_LEFT.depth, "incoming.FAST_LEFT に depth が無い"],
    ["数値でない速度", (r: any) => (r.incoming.FAST_LEFT.moveSpeed = "fast"), "incoming.FAST_LEFT.moveSpeed が数値ではない"],
    ["存在しない局面名 (書き間違い)", (r: any) => (r.incoming.THREAT_FASTT = r.incoming.THREAT_FAST), "incoming.THREAT_FASTT は存在しない局面"],
    ["待機位置の欠落", (r: any) => delete r.readyPosition, "readyPosition が無い"],
    ["CPUの動作パターンの欠落", (r: any) => delete r.cpuStyle, "cpuStyle が無い"],
    ["選択肢に無いCPUの動作パターン", (r: any) => (r.cpuStyle = "YOLO"), "cpuStyle が選択肢に無い"],
  ])("should reject %s", (_label, mutate, expected) => {
    const raw = fullRaw();
    mutate(raw);
    const { playbook, issues } = validatePlaybook(raw, "TOP", CFG);
    expect(playbook).toBeNull();
    expect(issues.join(" / ")).toContain(expected);
  });

  it("should clamp out-of-range speeds and record it, without rejecting", () => {
    const raw = fullRaw();
    (raw.incoming as any).THREAT_FAST.moveSpeed = 9999;
    (raw.incoming as any).THREAT_FAST.swingSpeed = 9999;
    const { playbook, issues, notes } = validatePlaybook(raw, "TOP", CFG);
    expect(issues).toEqual([]);
    expect(playbook!.incoming.THREAT_FAST!.moveSpeed).toBe(CFG.maxMalletSpeed);
    expect(playbook!.incoming.THREAT_FAST!.swingSpeed).toBe(CFG.maxMalletSpeed);
    expect(notes.join()).toContain("incoming.THREAT_FAST.moveSpeed");
  });

  it("should offer every situation in the shared LLM schema", () => {
    expect(PLAYBOOK_CHOICE_SCHEMA.properties.incoming.items.properties.situation.enum).toEqual([...INCOMING_SITUATIONS]);
    expect(PLAYBOOK_CHOICE_SCHEMA.properties.lingering.items.properties.situation.enum).toEqual([...LINGERING_SITUATIONS]);
  });

  it("should keep the LLM schema small enough for structured output", () => {
    // 20局面を別々のプロパティに展開していたとき、Claude が
    // 「The compiled grammar is too large」(400) で作戦タイムを拒否した。
    // 1局面ぶんの問いを配列の要素として1回だけ定義し、展開を抑える
    const json = JSON.stringify(PLAYBOOK_CHOICE_SCHEMA);
    expect(json.length).toBeLessThan(3000);
    expect(json.match(/"timing"/g)).toHaveLength(4); // 2グループ × (properties + required)
  });

  /** LLM が返す配列の形 */
  function arrayRaw() {
    const raw = fullRaw();
    return {
      ...raw,
      incoming: Object.entries(raw.incoming).map(([situation, m]) => ({ situation, ...m })),
      lingering: Object.entries(raw.lingering).map(([situation, m]) => ({ situation, ...m })),
    };
  }

  it("should accept the array form the LLMs return", () => {
    const { playbook, issues } = validatePlaybook(arrayRaw(), "TOP", CFG);
    expect(issues).toEqual([]);
    expect(countMoves(playbook!)).toBe(20);
  });

  it("should reject a situation that appears twice, or is left out, in the array form", () => {
    const raw = arrayRaw();
    raw.incoming[1] = { ...raw.incoming[1], situation: "THREAT_FAST" }; // THREAT_SLOW の代わりに THREAT_FAST が2つ
    const { playbook, issues } = validatePlaybook(raw, "TOP", CFG);
    expect(playbook).toBeNull();
    expect(issues).toContain("incoming.THREAT_FAST が重複している");
    expect(issues).toContain("incoming.THREAT_SLOW が無い");
  });
});

describe("Jev playbook questions", () => {
  const ctx = { side: "TOP" as const, config: CFG, targetScore: 7 };

  it("should split the strategy into two requests of choice / score questions", () => {
    const requests = buildPlaybookQuestions(ctx);
    expect(requests).toHaveLength(2);
    const total = requests.reduce((n, r) => n + Object.keys(r.questions).length, 0);
    expect(total).toBe(20 * 5 + 2);
    for (const r of requests) {
      for (const q of Object.values(r.questions)) expect(["choice", "score"]).toContain(q.type);
    }
  });

  it("should turn Jev's answers into a complete playbook", () => {
    const answers: Record<string, unknown> = {
      ready: { type: "choice", choice: "MID_CENTER" },
      cpu_style: { type: "choice", choice: "COUNTER" },
    };
    for (const s of [...INCOMING_SITUATIONS, ...LINGERING_SITUATIONS]) {
      answers[`${s}__timing`] = { type: "choice", choice: "REBOUND_MID" };
      answers[`${s}__aim`] = { type: "choice", choice: "BANK_LEFT" };
      answers[`${s}__path`] = { type: "choice", choice: "CURVE_RIGHT" };
      answers[`${s}__speed`] = { type: "score", score: 3 };
      answers[`${s}__power`] = { type: "score", score: 2 };
    }

    const { playbook, issues } = validatePlaybook(answersToRawPlaybook(answers, ctx), "TOP", CFG);
    expect(issues).toEqual([]);
    expect(countMoves(playbook!)).toBe(20);
    expect(playbook!.lingering.CORNER_LEFT).toMatchObject({ strikeTiming: "REBOUND", depth: "MID", aim: "BANK_LEFT", path: "CURVE_RIGHT", moveSpeed: 900, swingSpeed: 850 });
    expect(playbook!.readyPosition.y).toBeCloseTo(CFG.height * 0.28, 6);
    expect(playbook!.cpuStyle).toBe("COUNTER");
  });
});

describe("Same choice questions for every agent", () => {
  const ctx = { side: "TOP" as const, config: CFG, targetScore: 7 };

  it("should tell the AI what was wrong when asking it to redo the playbook", () => {
    expect(buildPlaybookPrompt(ctx)).not.toContain("# 作り直し");
    const redo = buildPlaybookPrompt({ ...ctx, previousIssues: ["incoming.THREAT_SLOW が無い"] });
    expect(redo).toContain("# 作り直し");
    expect(redo).toContain("incoming.THREAT_SLOW が無い");
  });

  it("should ask the LLM exactly the questions Jev gets for a shot", () => {
    const obs = {
      side: "TOP" as const,
      puckPos: new Vec2(300, 445),
      puckVel: new Vec2(250, -900),
      myMalletPos: new Vec2(300, 150),
      myMalletVel: new Vec2(0, 0),
      opponentMalletPos: new Vec2(380, 760),
      opponentMalletVel: new Vec2(0, 0),
      myScore: 0,
      opponentScore: 0,
      config: CFG,
    };
    const call = buildShotCall(obs);
    const jev = buildShotQuestions(obs).request.questions;

    expect(Object.keys((call.schema as any).properties)).toEqual(Object.keys(jev));
    expect((call.schema as any).properties.contact.enum).toEqual(Object.keys(jev.contact.criteria));

    // LLM の選択は、Jev の答えと同じ変換・同じ検証を通る
    const t = shotTelemetryFromChoices(
      { ok: true, latencyMs: 5, raw: { contact: call.contacts[1].key, aim: "GOAL_LEFT", path: "STRAIGHT", speed: "4", power: "3" } },
      call,
      obs
    );
    expect(t.status).toBe("OK");
    expect(t.plan!.contactTimeMs).toBeCloseTo(call.contacts[1].t * 1000, 6);
    expect(t.plan!.swingSpeed).toBe(1050);

    // 選択肢に無い答えは受け付けない
    const bad = shotTelemetryFromChoices({ ok: true, latencyMs: 5, raw: { contact: "t99999", aim: "GOAL_LEFT", path: "STRAIGHT", speed: "4", power: "3" } }, call, obs);
    expect(bad.status).toBe("INVALID");
    expect(bad.plan).toBeNull();
  });

  /** LLM が返す作戦 (配列の形) */
  function llmPlaybook() {
    const item = (situation: string) => ({ situation, timing: "DIRECT_EARLY", aim: "CLEAR", path: "STRAIGHT", speed: "2", power: "3" });
    return {
      summary: "テスト",
      ready: "DEEP_CENTER",
      cpu_style: "DEFENSE_FIRST",
      incoming: INCOMING_SITUATIONS.map(item),
      lingering: LINGERING_SITUATIONS.map(item),
    };
  }

  it("should accept a complete playbook from the LLM through the shared guardrail", () => {
    const t = playbookTelemetryFromChoices({ ok: true, latencyMs: 5, raw: llmPlaybook() }, ctx);
    expect(t.issues).toEqual([]);
    expect(countMoves(t.playbook!)).toBe(20);
    expect(t.playbook!.cpuStyle).toBe("DEFENSE_FIRST");
    expect(Object.keys(SITUATION_QUESTIONS)).toHaveLength(5);
  });

  it("should reject a duplicated or missing situation from the LLM", () => {
    const raw = llmPlaybook();
    raw.incoming[1] = { ...raw.incoming[1], situation: "THREAT_FAST" };
    const t = playbookTelemetryFromChoices({ ok: true, latencyMs: 5, raw }, ctx);
    expect(t.playbook).toBeNull();
    expect(t.status).toBe("INVALID");
    expect(t.issues).toContain("incoming.THREAT_FAST が重複している");
    expect(t.issues.join()).toContain("incoming.THREAT_SLOW");
  });
});

describe("CPU styles (CPU代行の動作パターン)", () => {
  const obs = {
    side: "TOP" as const,
    puckPos: new Vec2(300, 445),
    puckVel: new Vec2(120, -700),
    myMalletPos: new Vec2(300, 150),
    myMalletVel: new Vec2(0, 0),
    opponentMalletPos: new Vec2(420, 760),
    opponentMalletVel: new Vec2(0, 0),
    myScore: 0,
    opponentScore: 0,
    config: CFG,
  };

  it.each([...CPU_STYLES])("%s should return a valid plan", async (style) => {
    const t = await new CpuAgentClient(style).decideShot(obs);
    if (style === "DEFENSE_FIRST" && t.plan === null) return; // ゴールへ来る球は塞ぎに行く
    expect(t.status === "OK" || t.status === "CLAMPED").toBe(true);
    expect(t.plan).not.toBeNull();
  });

  it("should change what the CPU chooses", async () => {
    const aim = async (style: (typeof CPU_STYLES)[number]) => (await new CpuAgentClient(style).decideShot(obs)).plan!;

    // 安全第一は必ず逃がす (相手ゴールではなく相手陣の奥へ)
    const clear = await aim("SAFE_CLEAR");
    expect(clear.aimPoint.y).toBeLessThan(CFG.height);
    // バンク重視は壁の向こうの鏡像を狙う
    const bank = await aim("BANK_SHOOTER");
    expect(bank.aimPoint.x < 0 || bank.aimPoint.x > CFG.width).toBe(true);
    // 直線重視はゴールの枠内を直接狙う
    const straight = await aim("STRAIGHT_SHOOTER");
    expect(Math.abs(straight.aimPoint.x - CFG.width / 2)).toBeLessThanOrEqual(CFG.goalWidth / 2);
    // 軟打は弱く振る
    expect((await aim("SOFT_CONTROL")).swingSpeed).toBeLessThan(CFG.maxMalletSpeed);
    // カウンターは引きつけより早く打つ
    expect((await aim("COUNTER")).contactTimeMs).toBeLessThanOrEqual((await aim("PATIENT")).contactTimeMs);
  });

  it("should block a shot on goal when defending first", async () => {
    const threat = { ...obs, puckVel: new Vec2(0, -900) };
    expect((await new CpuAgentClient("DEFENSE_FIRST").decideShot(threat)).plan).toBeNull();
    expect((await new CpuAgentClient("BALANCED").decideShot(threat)).plan).not.toBeNull();
  });

  it("should offer all 10 styles to the LLM, and require one", () => {
    expect(PLAYBOOK_CHOICE_SCHEMA.properties.cpu_style.enum).toEqual([...CPU_STYLES]);
    expect(PLAYBOOK_CHOICE_SCHEMA.required).toContain("cpu_style");
    expect(CPU_STYLES).toHaveLength(10);
  });
});
