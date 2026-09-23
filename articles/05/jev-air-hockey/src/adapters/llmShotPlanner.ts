/**
 * Shared Agent Plumbing (Clean Architecture - Adapter Layer)
 *
 * クラウドAIのエージェント (Claude / Gemini / Jev) に共通する部品:
 * 実時間の上限、局面・選択肢の説明文、応答をガードレールに通してテレメトリにする変換。
 * 問いそのものは [[choiceQuestions]]、LLM への書き起こしは [[llmChoiceProtocol]]。
 */

import { AirHockeyObservation, PlaybookContext, PlaybookTelemetry } from "./agentClient";
import {
  INCOMING_SITUATIONS,
  LINGERING_SITUATIONS,
  PLAYBOOK_AIMS,
  CPU_STYLES,
  validatePlaybook,
} from "../domain/playbook";
import { AgentTelemetry, MindGameChat } from "../domain/jevAgentTypes";
import { validateShotPlan } from "../domain/shotPlanValidator";

/**
 * 判断1回あたりの実時間上限 (ms)。
 * これが無いと、API応答がハングした瞬間にシミュレーションループ全体が
 * (両陣営・パックともども) 永久に停止する — resolveDecisions() の
 * Promise.all() をゲームの唯一のsimTickが直接 await しているため。
 *
 * 判断待ちの間は中央線で時計が止まっているので、上限を延ばしてもゲーム内の結果は
 * 変わらない (止まっている時間が延びるだけ)。短くすると、応答の遅いAIほど
 * 判断を捨てることになり、推論力ではなく応答速度を比べることになる。
 * 時間切れの局面は、そのエージェントが作戦タイムに立てた作戦で打つ。
 */
export const DECISION_TIMEOUT_MS = 15000;

/** 作戦タイムの実時間上限 (ms)。20局面ぶんの作戦を一度に考えるので長めにとる */
export const PLAYBOOK_TIMEOUT_MS = 60000;

class DecisionTimeoutError extends Error {}

/** 実際のAPI呼び出しに実時間の上限を設ける */
export async function withTimeout<T>(promise: Promise<T>, ms: number = DECISION_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DecisionTimeoutError(`${ms}ms以内に応答がありませんでした`)), ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

export function isDecisionTimeout(e: unknown): e is DecisionTimeoutError {
  return e instanceof DecisionTimeoutError;
}

// ─── 作戦タイム ─────────────────────────────────────────

/** 局面の説明。プロンプトと Jev の問いの両方で使う */
export const INCOMING_DESCRIPTIONS: Record<(typeof INCOMING_SITUATIONS)[number], string> = {
  THREAT_FAST: "自陣ゴールへ入る軌道の速い球 (1200px/s 以上)",
  THREAT_SLOW: "自陣ゴールへ入る軌道の遅い球",
  BANK_FROM_LEFT: "自陣で左の側壁に当たってから来る球",
  BANK_FROM_RIGHT: "自陣で右の側壁に当たってから来る球",
  FAST_LEFT: "左寄りを来る速い球 (ゴールには入らない)",
  FAST_CENTER: "中央を来る速い球 (ゴールには入らない)",
  FAST_RIGHT: "右寄りを来る速い球 (ゴールには入らない)",
  SLOW_LEFT: "左寄りを来る遅い球",
  SLOW_CENTER: "中央を来る遅い球",
  SLOW_RIGHT: "右寄りを来る遅い球",
};

export const LINGERING_DESCRIPTIONS: Record<(typeof LINGERING_SITUATIONS)[number], string> = {
  ROLLING_TO_GOAL: "自陣ゴールへ向かって転がっている",
  NEAR_GOAL: "自陣ゴールの前 (ゴール幅の内側、ゴールラインから170px以内) に居る",
  CORNER_LEFT: "自陣の左奥の隅に居る",
  CORNER_RIGHT: "自陣の右奥の隅に居る",
  STOPPED_LEFT: "左寄りでほぼ止まっている",
  STOPPED_CENTER: "中央付近でほぼ止まっている",
  STOPPED_RIGHT: "右寄りでほぼ止まっている",
  WALL_SHUTTLE_LEFT: "左の側壁沿いを往復している",
  WALL_SHUTTLE_RIGHT: "右の側壁沿いを往復している",
  MOVING_OPEN: "自陣の開けた場所を動き回っている",
};

export const CPU_STYLE_DESCRIPTIONS: Record<(typeof CPU_STYLES)[number], string> = {
  BALANCED: "標準。得点・安全・相手の届きにくさを総合で判断する",
  ATTACK_FIRST: "攻撃優先。決まる球を大きく評価し、逃がすだけの球は選ばない",
  DEFENSE_FIRST: "防御優先。ゴールへ来る球は進路を塞ぎ、打つときは大きく逃がす",
  COUNTER: "カウンター。できるだけ早い打点で、相手の体勢が整う前に返す",
  PATIENT: "引きつけ。遅めの打点や壁の跳ね返りを待ってから打つ",
  BANK_SHOOTER: "バンク重視。側壁を使ったシュートを優先する",
  STRAIGHT_SHOOTER: "直線重視。ゴールへ直接のシュートだけを狙う",
  SAFE_CLEAR: "安全第一。常に相手から遠い奥へ逃がす",
  POWER: "強打。常に全力で振り、相手ゴールの中央付近を狙う",
  SOFT_CONTROL: "軟打。弱めに振って、相手マレットの逆へ置きにいく",
};

export const AIM_DESCRIPTIONS: Record<(typeof PLAYBOOK_AIMS)[number], string> = {
  GOAL_LEFT: "相手ゴールの左隅へ直接",
  GOAL_CENTER: "相手ゴールの中央へ直接",
  GOAL_RIGHT: "相手ゴールの右隅へ直接",
  BANK_LEFT: "左の側壁に当ててから相手ゴールへ",
  BANK_RIGHT: "右の側壁に当ててから相手ゴールへ",
  CLEAR: "相手マレットから遠い側の奥へ大きく逃がす",
  AWAY_FROM_OPPONENT: "相手ゴールの、相手マレットから遠い側の隅へ",
};

/** 作戦の生応答を検証して PlaybookTelemetry にする */
export function toPlaybookTelemetry(
  raw: unknown,
  ctx: PlaybookContext,
  rawLatencyMs: number,
  isLiveApi = true
): PlaybookTelemetry {
  const { playbook, issues, notes } = validatePlaybook(raw, ctx.side, ctx.config);
  return {
    playbook,
    status: playbook ? (notes.length > 0 ? "CLAMPED" : "OK") : "INVALID",
    rawLatencyMs,
    issues,
    notes,
    isLiveApi,
  };
}

export function playbookFailure(
  status: "ERROR" | "INVALID" | "TIMEOUT",
  reason: string,
  rawLatencyMs: number
): PlaybookTelemetry {
  return { playbook: null, status, rawLatencyMs, issues: [reason], notes: [], isLiveApi: true };
}

/** 構造化出力の呼び出し結果。判断にも作戦にも同じ形で使う */
export type StructuredCallResult =
  | { ok: true; raw: unknown; latencyMs: number }
  | { ok: false; status: "ERROR" | "INVALID" | "TIMEOUT"; reason: string; latencyMs: number };

/** 生応答をガードレールに通して AgentTelemetry に変換する */
export function toTelemetry(
  raw: unknown,
  obs: AirHockeyObservation,
  rawLatencyMs: number
): AgentTelemetry {
  const result = validateShotPlan(raw, obs.side, obs.config);
  return {
    plan: result.plan,
    status: result.status,
    rawLatencyMs,
    clampNotes: result.clampNotes,
    isLiveApi: true,
    latestChat: buildChat(result.plan?.comment),
  };
}

/** 通信失敗・応答不正時のテレメトリ。ローカル演算による救済は行わない */
export function failureTelemetry(
  status: "ERROR" | "INVALID" | "TIMEOUT",
  reason: string,
  rawLatencyMs: number
): AgentTelemetry {
  return {
    plan: null,
    status,
    rawLatencyMs,
    clampNotes: [reason],
    isLiveApi: true,
    latestChat: null,
  };
}

function buildChat(comment: string | undefined): MindGameChat | null {
  if (!comment) return null;
  return { text: comment, category: "CALCULATE", timestamp: Date.now() };
}
