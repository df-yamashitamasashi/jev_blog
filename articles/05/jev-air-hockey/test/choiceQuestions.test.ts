/**
 * Jev System One Question Mapping Tests (Vitest)
 *
 * Jev は choice / score / noul にしか答えられない。打ち返し計画を選択として問い、
 * 答えを他のエージェントと同じ ShotPlan へ戻す変換を固定する。
 */

import { describe, it, expect } from "vitest";
import { buildShotQuestions, answersToRawPlan, MOVE_SPEED_LEVELS, SWING_SPEED_LEVELS } from "../src/adapters/choiceQuestions";
import { AirHockeyObservation } from "../src/adapters/agentClient";
import { validateShotPlan } from "../src/domain/shotPlanValidator";
import { curveControlPoint } from "../src/domain/approachPath";
import { DEFAULT_STADIUM_CONFIG as CFG } from "../src/domain/gameState";
import { Vec2 } from "../src/domain/physics";

function observation(overrides: Partial<AirHockeyObservation> = {}): AirHockeyObservation {
  return {
    side: "TOP",
    puckPos: new Vec2(300, 445),
    puckVel: new Vec2(250, -900),
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

describe("buildShotQuestions", () => {
  it("should ask only choice / score questions, with contact options inside its own half", () => {
    const { request, contacts } = buildShotQuestions(observation());

    expect(Object.values(request.questions).every((q) => q.type === "choice" || q.type === "score")).toBe(true);
    expect(contacts.length).toBeGreaterThan(0);
    for (const c of contacts) expect(c.pos.y).toBeLessThanOrEqual(CFG.height * 0.5);
    expect(Object.keys(request.questions.contact.criteria as Record<string, string>)).toEqual(contacts.map((c) => c.key));
  });

  it("should mark contacts after a wall bounce as rebounds", () => {
    const { contacts } = buildShotQuestions(observation());
    // 右へ流れる球なので、途中で右の側壁に当たる
    expect(contacts.some((c) => c.rebound)).toBe(true);
    expect(contacts.some((c) => !c.rebound)).toBe(true);
  });
});

describe("answersToRawPlan", () => {
  const obs = observation();
  const { contacts } = buildShotQuestions(obs);
  const chosen = contacts[1];

  it("should place the mallet behind the puck, opposite the chosen aim", () => {
    const raw = answersToRawPlan(
      {
        contact: { choice: chosen.key },
        aim: { choice: "GOAL_CENTER" },
        path: { choice: "STRAIGHT" },
        speed: { score: 2 },
        power: { score: 3 },
      },
      obs,
      contacts
    )!;
    const { plan, status } = validateShotPlan(raw, "TOP", CFG);

    expect(status).toBe("OK");
    expect(plan!.contactTimeMs).toBeCloseTo(chosen.t * 1000, 6);
    expect(plan!.moveSpeed).toBe(MOVE_SPEED_LEVELS[2]);
    expect(plan!.swingSpeed).toBe(SWING_SPEED_LEVELS[3]);

    // 打点からパック中心までがちょうど接触距離で、その向きが狙いの向き
    const toPuck = chosen.pos.sub(plan!.interceptPoint);
    expect(toPuck.mag()).toBeCloseTo(CFG.puckRadius + CFG.malletRadius, 6);
    const toAim = plan!.aimPoint.sub(chosen.pos).normalize();
    expect(toPuck.normalize().dot(toAim)).toBeCloseTo(1, 6);
  });

  it("should turn a screen-right curve into a bulge toward the right of the screen", () => {
    for (const [path, sign] of [["CURVE_RIGHT", 1], ["CURVE_LEFT", -1]] as const) {
      const raw = answersToRawPlan(
        { contact: { choice: chosen.key }, aim: { choice: "GOAL_CENTER" }, path: { choice: path }, speed: { score: 4 }, power: { score: 3 } },
        obs,
        contacts
      )!;
      const plan = validateShotPlan(raw, "TOP", CFG).plan!;
      const from = obs.myMalletPos;
      const to = plan.interceptPoint;
      const control = curveControlPoint(from, to, plan.curveOffset);
      const mid = from.add(to).scale(0.5);
      expect(Math.sign(control.x - mid.x)).toBe(sign);
    }
  });

  it("should reject answers that are missing or not among the options", () => {
    expect(answersToRawPlan(null, obs, contacts)).toBeNull();
    expect(answersToRawPlan({ aim: { choice: "GOAL_CENTER" }, path: { choice: "STRAIGHT" } }, obs, contacts)).toBeNull();
    expect(
      answersToRawPlan({ contact: { choice: "t99999" }, aim: { choice: "GOAL_CENTER" }, path: { choice: "STRAIGHT" } }, obs, contacts)
    ).toBeNull();
    expect(
      answersToRawPlan({ contact: { choice: chosen.key }, aim: { choice: "SOMEWHERE" }, path: { choice: "STRAIGHT" } }, obs, contacts)
    ).toBeNull();
  });
});
