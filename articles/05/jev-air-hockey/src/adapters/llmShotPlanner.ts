/**
 * Shared LLM Shot Planning (Clean Architecture - Adapter Layer)
 *
 * 3つのLLMエージェントに完全に同一の盤面情報・同一のスキーマを渡すための共通層。
 * プロンプトが異なると比較が成立しないため、文面はここ1箇所だけで管理する。
 */

import { AirHockeyObservation } from "./agentClient";
import { AgentTelemetry, MindGameChat } from "../domain/jevAgentTypes";
import { validateShotPlan, malletYRange } from "../domain/shotPlanValidator";
import { predictPuckPath } from "../domain/puckPredictor";

/** 全エージェント共通の応答スキーマ (JSON Schema) */
export const SHOT_PLAN_SCHEMA = {
  type: "object",
  properties: {
    interceptPoint: {
      type: "object",
      description:
        "接触の瞬間にマレット中心を置く座標 (自陣内)。パック座標ではなく、狙いと反対側へ回り込んだ位置",
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
  const forecast = describeForecast(obs);

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

# パックの軌道予測 (壁反射を含む実物理による積分結果)
${forecast}

# 物理定数
- 側壁の反発係数: ${config.wallRestitution} (左右の壁で反射します)
- パックとマレットの反発係数: ${config.malletRestitution}
- パックの空気抵抗: 1秒あたり速度が ${config.puckFriction} 倍に減衰
- マレットの最大速度: ${config.maxMalletSpeed} px/s (これを超える指定は切り捨てられます)
- マレットの最大加速度: ${config.maxMalletAccel} px/s²

# 打ち返しの物理 (最重要)
パックが飛んでいく向きを決めるのは **スイングの向きではなく接触法線** です。
接触法線とは「マレットの中心からパックの中心へ向かうベクトル」で、パックはこの向きに押し出されます。

したがって狙った場所へ飛ばす手段は「振る向きを変えること」ではなく
**パックの向こう側 (狙いと反対側) へ回り込むこと** です。

- 接触の瞬間、マレット中心は次の位置にある必要があります:
  \`パック中心 − (狙いへの単位ベクトル) × ${config.puckRadius + config.malletRadius}\`
  (${config.puckRadius + config.malletRadius} = パック半径 ${config.puckRadius} + マレット半径 ${config.malletRadius})
- したがって interceptPoint には「パックの座標」ではなく、上の式で求まる **マレットを置く座標** を指定してください。
- swingSpeed は球威を決めます。ただし飛んでくるパックの運動量が残るため、弱く振ると出射方向が入射方向に引っ張られます。向きを大きく変えたいなら強く振る必要があります。
- swingDirDeg は接触法線と同じ向き (= 狙いの向き) にするのが最も効率的です。

# その他のルール
1. 迎撃点が遠すぎると最大速度でも間に合わず空振りします。上の軌道予測から、到達できる時刻・座標を選んでください。
2. 迎撃点に到達した瞬間に接触するように選ぶと、マレットが止まった状態で当たるだけになり球威が出ません。振りかぶる余裕 (${Math.round((config.maxMalletSpeed / config.maxMalletAccel) * 1000)}ms 程度) を残した時刻を選んでください。
3. 側壁への反射を使えます。壁で1回跳ね返してゴールへ入れたい場合、aimPoint には「壁の向こう側にある鏡像の座標」を指定してください (左壁なら x を負の値に)。
4. 相手マレットが届く軌道は止められます。相手の現在位置と速度から、間に合わない側を狙ってください。

# 出力
interceptPoint (マレット中心を置く座標), swingDirDeg (振り抜く方向), swingSpeed (スイング速度), aimPoint (パックを飛ばしたい座標) を返してください。`;
}

/**
 * パックの未来位置を時刻つきで書き出す。
 *
 * 軌道を自力で解かせると、壁の反射・空気抵抗・ゴール開口部の扱いで必ず取りこぼしが
 * 出る。ここで測るべきは「軌道の数値積分ができるか」ではなく「与えられた盤面から
 * どこをどう狙うか」なので、予測は全エージェントへ同じ精度で開示する。
 */
function describeForecast(obs: AirHockeyObservation): string {
  const { config, side } = obs;
  const traj = predictPuckPath(obs.puckPos, obs.puckVel, config, { horizonSec: 1.6 });
  const contactDist = config.puckRadius + config.malletRadius;

  const lines: string[] = [];
  const stepSec = 0.1;
  const stride = Math.max(1, Math.round(stepSec / traj.dt));

  for (let i = 0; i < traj.samples.length; i += stride) {
    const sample = traj.samples[i];
    const inMyHalf = side === "TOP" ? sample.pos.y <= config.height * 0.52 : sample.pos.y >= config.height * 0.48;
    lines.push(
      `- ${(sample.t * 1000).toFixed(0)}ms後: 位置 (${round(sample.pos.x)}, ${round(sample.pos.y)}) / 速度 (${round(sample.vel.x)}, ${round(sample.vel.y)})${inMyHalf ? " ← 自陣" : ""}`
    );
    if (lines.length >= 16) break;
  }

  if (traj.goalAt !== null) {
    const who = traj.goalConcededBy === side ? "あなたの失点" : "相手の失点";
    lines.push(`- ${(traj.goalAt * 1000).toFixed(0)}ms後: このままだとゴールに入ります (${who})`);
  }

  if (traj.bounceTimes.length > 0) {
    const bounces = traj.bounceTimes.slice(0, 4).map((t) => `${(t * 1000).toFixed(0)}ms`).join(", ");
    lines.push(`- 壁で跳ね返る時刻: ${bounces}`);
  }

  lines.push(
    `- 参考: 接触時にマレット中心とパック中心の距離は ${contactDist}px になります`
  );

  return lines.join("\n");
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
