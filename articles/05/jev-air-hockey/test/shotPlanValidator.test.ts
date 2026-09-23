/**
 * ShotPlan Guardrail Tests (Vitest)
 */

import { describe, it, expect } from "vitest";
import { validateShotPlan, aimErrorDeg, malletYRange } from "../src/domain/shotPlanValidator";
import { DEFAULT_STADIUM_CONFIG as CFG } from "../src/domain/gameState";
import { Vec2 } from "../src/domain/physics";

const validPlan = {
  interceptPoint: { x: 300, y: 150 },
  contactTimeMs: 320,
  swingDirDeg: 90,
  swingSpeed: 600,
  aimPoint: { x: 300, y: 900 },
};

describe("validateShotPlan", () => {
  it("should accept a physically valid plan unchanged", () => {
    const result = validateShotPlan(validPlan, "TOP", CFG);
    expect(result.status).toBe("OK");
    expect(result.clampNotes).toHaveLength(0);
    expect(result.plan!.interceptPoint.x).toBe(300);
    expect(result.plan!.swingSpeed).toBe(600);
  });

  it.each([
    ["null", null],
    ["文字列", "DEFENSIVE_WALL"],
    ["空オブジェクト", {}],
    ["NaN速度", { ...validPlan, swingSpeed: NaN }],
    ["Infinity角度", { ...validPlan, swingDirDeg: Infinity }],
    ["座標欠落", { ...validPlan, interceptPoint: { x: 300 } }],
    ["狙い点なし", { ...validPlan, aimPoint: undefined }],
    ["接触時刻なし", { ...validPlan, contactTimeMs: undefined }],
  ])("should reject %s as INVALID", (_label, raw) => {
    const result = validateShotPlan(raw, "TOP", CFG);
    expect(result.status).toBe("INVALID");
    expect(result.plan).toBeNull();
    expect(result.clampNotes.length).toBeGreaterThan(0);
  });

  it("should clamp an over-limit swing speed and record it", () => {
    const result = validateShotPlan({ ...validPlan, swingSpeed: 99999 }, "TOP", CFG);
    expect(result.status).toBe("CLAMPED");
    expect(result.plan!.swingSpeed).toBe(CFG.maxMalletSpeed);
    expect(result.clampNotes.join()).toContain("swingSpeed");
  });

  it("should never let an agent reach into the opponent half", () => {
    // TOP側が相手陣内 (y=800) を迎撃点に指定
    const top = validateShotPlan({ ...validPlan, interceptPoint: { x: 300, y: 800 } }, "TOP", CFG);
    const [, topMaxY] = malletYRange("TOP", CFG);
    expect(top.status).toBe("CLAMPED");
    expect(top.plan!.interceptPoint.y).toBeLessThanOrEqual(topMaxY);

    // BOTTOM側が相手陣内 (y=100) を指定
    const bottom = validateShotPlan({ ...validPlan, interceptPoint: { x: 300, y: 100 } }, "BOTTOM", CFG);
    const [bottomMinY] = malletYRange("BOTTOM", CFG);
    expect(bottom.status).toBe("CLAMPED");
    expect(bottom.plan!.interceptPoint.y).toBeGreaterThanOrEqual(bottomMinY);
  });

  it("should normalize swing angles without flagging them as clamped", () => {
    const negative = validateShotPlan({ ...validPlan, swingDirDeg: -90 }, "TOP", CFG);
    expect(negative.status).toBe("OK");
    expect(negative.plan!.swingDirDeg).toBe(270);

    const wrapped = validateShotPlan({ ...validPlan, swingDirDeg: 450 }, "TOP", CFG);
    expect(wrapped.status).toBe("OK");
    expect(wrapped.plan!.swingDirDeg).toBe(90);
  });

  it("should default the movement to a straight line at full speed", () => {
    const plan = validateShotPlan(validPlan, "TOP", CFG).plan!;
    expect(plan.movePath).toBe("STRAIGHT");
    expect(plan.curveOffset).toBe(0);
    expect(plan.moveSpeed).toBe(CFG.maxMalletSpeed);
    expect(plan.strikeTiming).toBe("DIRECT");
    expect(plan.contactTimeMs).toBe(320);
  });

  it("should cap the movement speed at the shared mallet limit", () => {
    const result = validateShotPlan({ ...validPlan, moveSpeed: 5000 }, "TOP", CFG);
    expect(result.status).toBe("CLAMPED");
    expect(result.plan!.moveSpeed).toBe(CFG.maxMalletSpeed);
    expect(result.clampNotes.join()).toContain("moveSpeed");
  });

  it("should keep a declared curve and rebound strike", () => {
    const plan = validateShotPlan(
      { ...validPlan, movePath: "CURVE", curveOffset: -80, strikeTiming: "REBOUND" },
      "TOP",
      CFG
    ).plan!;
    expect(plan.movePath).toBe("CURVE");
    expect(plan.curveOffset).toBe(-80);
    expect(plan.strikeTiming).toBe("REBOUND");
  });

  it("should keep the mallet inside the side walls", () => {
    const result = validateShotPlan({ ...validPlan, interceptPoint: { x: -500, y: 150 } }, "TOP", CFG);
    expect(result.plan!.interceptPoint.x).toBe(CFG.malletRadius);
    expect(result.clampNotes.join()).toContain("interceptPoint.x");
  });
});

describe("aimErrorDeg", () => {
  const contact = new Vec2(300, 200);

  it("should report ~0 degrees when the puck goes exactly where intended", () => {
    const plan = validateShotPlan(validPlan, "TOP", CFG).plan!;
    // 狙い点 (300, 900) は接触点の真下 → 実速度も真下
    expect(aimErrorDeg(plan, contact, new Vec2(0, 1200))!).toBeCloseTo(0, 3);
  });

  it("should report 90 degrees for a perpendicular miss", () => {
    const plan = validateShotPlan(validPlan, "TOP", CFG).plan!;
    expect(aimErrorDeg(plan, contact, new Vec2(1200, 0))!).toBeCloseTo(90, 3);
  });

  it("should return null when there is no meaningful direction", () => {
    const plan = validateShotPlan(validPlan, "TOP", CFG).plan!;
    expect(aimErrorDeg(plan, contact, new Vec2(0, 0))).toBeNull();
  });
});
