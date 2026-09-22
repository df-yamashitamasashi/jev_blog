/**
 * ShotPlan Guardrails (Clean Architecture - Domain Layer)
 *
 * LLMの応答は信頼できない外部入力として扱う。物理的に不可能な値は
 * 「黙って直す」のではなく、丸めた事実を clampNotes に記録して計測対象にする。
 */

import { Vec2 } from "./physics";
import { StadiumConfig } from "./gameState";
import { ShotPlan, DecisionStatus } from "./jevAgentTypes";

export interface ValidationResult {
  plan: ShotPlan | null;
  status: DecisionStatus;
  clampNotes: string[];
}

export type PlaySide = "TOP" | "BOTTOM";

/** そのエージェントがマレットを置ける Y 範囲 */
export function malletYRange(side: PlaySide, config: StadiumConfig): [number, number] {
  const margin = config.malletRadius;
  return side === "TOP"
    ? [margin, config.height * 0.48]
    : [config.height * 0.52, config.height - margin];
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function readPoint(raw: unknown): Vec2 | null {
  if (!raw || typeof raw !== "object") return null;
  const { x, y } = raw as { x?: unknown; y?: unknown };
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;
  return new Vec2(x, y);
}

function clampWithNote(
  value: number,
  min: number,
  max: number,
  label: string,
  notes: string[]
): number {
  const clamped = Math.max(min, Math.min(max, value));
  if (clamped !== value) {
    notes.push(`${label}: ${Math.round(value)} → ${Math.round(clamped)}`);
  }
  return clamped;
}

/**
 * LLM の生応答を検証し、物理的に実行可能な ShotPlan に落とし込む。
 * 解釈できない場合は INVALID を返し、呼び出し側はそのラリーを空振りとして扱う。
 */
export function validateShotPlan(
  raw: unknown,
  side: PlaySide,
  config: StadiumConfig
): ValidationResult {
  if (!raw || typeof raw !== "object") {
    return { plan: null, status: "INVALID", clampNotes: ["応答がオブジェクトではない"] };
  }

  const source = raw as Record<string, unknown>;
  const intercept = readPoint(source.interceptPoint);
  const aim = readPoint(source.aimPoint);
  const swingDirDeg = source.swingDirDeg;
  const swingSpeed = source.swingSpeed;

  const missing: string[] = [];
  if (!intercept) missing.push("interceptPoint");
  if (!aim) missing.push("aimPoint");
  if (!isFiniteNumber(swingDirDeg)) missing.push("swingDirDeg");
  if (!isFiniteNumber(swingSpeed)) missing.push("swingSpeed");

  if (!intercept || !aim || !isFiniteNumber(swingDirDeg) || !isFiniteNumber(swingSpeed)) {
    return {
      plan: null,
      status: "INVALID",
      clampNotes: [`必須項目の欠落または非数値: ${missing.join(", ")}`],
    };
  }

  const notes: string[] = [];
  const [minY, maxY] = malletYRange(side, config);
  const margin = config.malletRadius;

  const interceptPoint = new Vec2(
    clampWithNote(intercept.x, margin, config.width - margin, "interceptPoint.x", notes),
    clampWithNote(intercept.y, minY, maxY, "interceptPoint.y", notes)
  );

  // 狙い点は相手ゴール奥を指定できるよう、コート外側にも余白を許す
  const aimPoint = new Vec2(
    clampWithNote(aim.x, -config.width, config.width * 2, "aimPoint.x", notes),
    clampWithNote(aim.y, -config.height, config.height * 2, "aimPoint.y", notes)
  );

  const speed = clampWithNote(swingSpeed, 0, config.maxMalletSpeed, "swingSpeed", notes);

  // 角度は丸めではなく正規化なので clamp 扱いにしない
  const normalizedDir = ((swingDirDeg % 360) + 360) % 360;

  const comment =
    typeof source.comment === "string" && source.comment.trim().length > 0
      ? source.comment.trim().slice(0, 80)
      : undefined;

  return {
    plan: { interceptPoint, swingDirDeg: normalizedDir, swingSpeed: speed, aimPoint, comment },
    status: notes.length > 0 ? "CLAMPED" : "OK",
    clampNotes: notes,
  };
}

/**
 * 宣言した狙い点の方向と、実際にパックが飛んだ方向との角度差 (度, 0-180)。
 * 「物理を理解して打てているか」の中核指標。
 */
export function aimErrorDeg(plan: ShotPlan, contactPos: Vec2, actualVel: Vec2): number | null {
  const intended = plan.aimPoint.sub(contactPos);
  if (intended.magSq() < 1e-6 || actualVel.magSq() < 1e-6) return null;

  const cos = intended.normalize().dot(actualVel.normalize());
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}
