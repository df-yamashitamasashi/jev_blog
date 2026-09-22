/**
 * Shared LLM Shot Planning (Clean Architecture - Adapter Layer)
 *
 * 3つのLLMエージェントに完全に同一の盤面情報・同一のスキーマを渡すための共通層。
 * プロンプトが異なると比較が成立しないため、文面はここ1箇所だけで管理する。
 */

import { AirHockeyObservation } from "./agentClient";
import { AgentTelemetry, MindGameChat } from "../domain/jevAgentTypes";
import { validateShotPlan, malletYRange } from "../domain/shotPlanValidator";

/** 全エージェント共通の応答スキーマ (JSON Schema) */
export const SHOT_PLAN_SCHEMA = {
  type: "object",
  properties: {
    interceptPoint: {
      type: "object",
      description: "自陣内でパックを迎え撃つ座標",
      properties: { x: { type: "number" }, y: { type: "number" } },
      required: ["x", "y"],
      additionalProperties: false,
    },
    swingDirDeg: {
      type: "number",
      description: "接触時にマレットを振り抜く方向。0=右(+x), 90=下(+y), 180=左, 270=上",
    },
    swingSpeed: {
      type: "number",
      description: "接触時のマレット速度 (px/s)",
    },
    aimPoint: {
      type: "object",
      description: "パックを飛ばしたい座標 (通常は相手ゴール)",
      properties: { x: { type: "number" }, y: { type: "number" } },
      required: ["x", "y"],
      additionalProperties: false,
    },
    comment: {
      type: "string",
      description: "観客向けの短い日本語コメント (30文字以内)",
    },
  },
  required: ["interceptPoint", "swingDirDeg", "swingSpeed", "aimPoint"],
  additionalProperties: false,
} as const;

const round = (n: number) => Math.round(n);

/**
 * 判断1回あたりの実時間上限 (ms)。
 * これが無いと、API応答がハングした瞬間にシミュレーションループ全体が
 * (両陣営・パックともども) 永久に停止する — resolveDecisions() の
 * Promise.all() をゲームの唯一のsimTickが直接 await しているため。
 * decisionBudgetMs (ゲーム内時間) とは無関係な、実時間側の安全装置。
 */
export const DECISION_TIMEOUT_MS = 15000;

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

/**
 * 盤面の完全な物理状態を文章化する。
 * 迎撃点の計算に必要な定数をすべて開示し、AIが自力で軌道を解けるようにする。
 */
export function buildShotPlanPrompt(obs: AirHockeyObservation): string {
  const { config, side } = obs;
  const [minY, maxY] = malletYRange(side, config);
  const goalLeft = (config.width - config.goalWidth) * 0.5;
  const goalRight = (config.width + config.goalWidth) * 0.5;

  const myGoalY = side === "TOP" ? 0 : config.height;
  const opponentGoalY = side === "TOP" ? config.height : 0;

  return `あなたはエアホッケーの${side === "TOP" ? "上側(TOP)" : "下側(BOTTOM)"}のマレットを操作しています。
次の1打をどう返すかを決めてください。

# 座標系
原点は左上。x は右へ、y は下へ増加します。角度は 0°=右(+x), 90°=下(+y), 180°=左, 270°=上。

# コート
- 大きさ: 幅 ${config.width} × 高さ ${config.height}
- ゴール開口部の x 範囲: ${round(goalLeft)} 〜 ${round(goalRight)}
- あなたが守るゴール: y = ${myGoalY}
- あなたが狙うゴール: y = ${opponentGoalY}
- あなたのマレットが存在できる y 範囲: ${round(minY)} 〜 ${round(maxY)} (この外へは出られません)

# 現在の状態
- パック: 位置 (${round(obs.puckPos.x)}, ${round(obs.puckPos.y)}) / 速度 (${round(obs.puckVel.x)}, ${round(obs.puckVel.y)}) px/s / 半径 ${config.puckRadius} / 質量 ${config.puckMass}kg
- あなたのマレット: 位置 (${round(obs.myMalletPos.x)}, ${round(obs.myMalletPos.y)}) / 速度 (${round(obs.myMalletVel.x)}, ${round(obs.myMalletVel.y)}) px/s / 半径 ${config.malletRadius} / 質量 ${config.malletMass}kg
- 相手のマレット: 位置 (${round(obs.opponentMalletPos.x)}, ${round(obs.opponentMalletPos.y)}) / 速度 (${round(obs.opponentMalletVel.x)}, ${round(obs.opponentMalletVel.y)}) px/s
- スコア: あなた ${obs.myScore} - 相手 ${obs.opponentScore}

# 物理定数
- 側壁の反発係数: ${config.wallRestitution} (左右の壁で反射します)
- パックとマレットの反発係数: ${config.malletRestitution}
- パックの空気抵抗: 1秒あたり速度が ${config.puckFriction} 倍に減衰
- マレットの最大速度: ${config.maxMalletSpeed} px/s (これを超える指定は切り捨てられます)
- マレットの最大加速度: ${config.maxMalletAccel} px/s²

# 重要なルール
1. パックの出射速度・角度は直接指定できません。接触した瞬間のマレットの速度ベクトルから物理的に決まります。強く返したいならスイング速度を上げ、方向を変えたいならスイング方向を変えてください。
2. 迎撃点が遠すぎると最大速度でも間に合わず空振りします。パックの軌道を予測し、到達可能な位置を選んでください。
3. 側壁への反射を考慮してください。パックは左右の壁で跳ね返ります。

# 出力
interceptPoint (迎撃座標), swingDirDeg (振り抜く方向), swingSpeed (スイング速度), aimPoint (パックを飛ばしたい座標) を返してください。`;
}

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
