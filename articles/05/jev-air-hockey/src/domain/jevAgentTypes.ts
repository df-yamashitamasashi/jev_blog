/**
 * Jev System One Reactive Agent Types (Clean Architecture - Domain Layer)
 * エアホッケーにおけるJevの意思決定プリミティブと戦術モデル
 */

import { Vec2 } from "./physics";

/** 飛んでくるパックをそのまま打つか、壁で跳ね返ったあとを打つか */
export type StrikeTiming = "DIRECT" | "REBOUND";

/** 打点 (の手前の構え位置) までの移動経路 */
export type MovePath = "STRAIGHT" | "CURVE";

/**
 * エージェントが返す打ち返し計画。
 *
 * 判断はパックが中央線を越えて自陣へ入ってくる瞬間の **1回だけ**。
 * サーボはこの計画を開ループで実行し、パックを見て打点を補正することはしない。
 * したがって軌道予測 (いつ・どこにパックが来るか) を外せば、そのまま空振りになる。
 *
 * 重要: パックの出射速度・角度はここで指定しない。接触時のマレット速度から
 * 物理エンジンが導出する。
 */
export interface ShotPlan {
  interceptPoint: Vec2;  // 接触の瞬間にマレット中心を置く座標 (自陣内)
  contactTimeMs: number; // 判断時点から接触までの時間 (ms)。予測の核心
  strikeTiming: StrikeTiming;
  swingDirDeg: number;   // 接触時にマレットを振り抜く方向 (0-360, 画面座標系で右が0°, 下が90°)
  swingSpeed: number;    // 接触時のマレット速度 (px/s)
  movePath: MovePath;
  curveOffset: number;   // CURVE のふくらみ (px)。移動方向に対して右が正
  moveSpeed: number;     // 構え位置までの移動速度の上限 (px/s)
  aimPoint: Vec2;        // 「パックをここへ飛ばしたい」という意図の宣言
  comment?: string;      // HUD表示用の短いコメント
}

/**
 * 判断の結果ステータス。
 * ローカルヒューリスティックによる救済は行わないため、OK/CLAMPED 以外はその場で
 * 打ち返しを放棄する (= 空振り) ことを意味する。
 */
export type DecisionStatus =
  | "OK"       // 妥当な計画を受信
  | "CLAMPED"  // 物理的に不可能な値を含んでいたため制限値に丸めた
  | "INVALID"  // 解釈不能な応答 (NaN・必須項目欠落など)
  | "ERROR"    // 通信失敗・APIエラー
  | "TIMEOUT"; // 制限時間内に応答が返らなかった

/** 心理戦煽り・実況コメント */
export interface MindGameChat {
  text: string;
  category: "INTIMIDATE" | "TAUNT" | "PRAISE" | "CALCULATE";
  timestamp: number;
}

/** 1回の意思決定の記録 */
export interface AgentTelemetry {
  plan: ShotPlan | null;
  status: DecisionStatus;
  rawLatencyMs: number;   // 実測の往復時間。記録するが勝敗には影響させない
  clampNotes: string[];   // どの値をどう丸めたかの記録
  isLiveApi: boolean;     // 実際にクラウドAPIへ問い合わせたか
  latestChat: MindGameChat | null;
}

/** トーナメント集計値 */
export interface AgentStats {
  agent: AgentType;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  goalsFor: number;
  goalsAgainst: number;
  decisions: number;      // 判断を要求した回数
  saves: number;          // 実際にパックへ触れた回数
  whiffs: number;         // 迎撃点に間に合わなかった回数
  clamped: number;
  invalid: number;
  errors: number;
  timeouts: number;
  aimErrorSumDeg: number; // 狙い誤差の合計 (度)
  aimErrorSamples: number;
  predictionErrorSumPx: number; // 予告した接触時刻に、パックが予告した位置からどれだけずれていたか
  predictionSamples: number;
  cpuTakeovers: number;   // 作戦に当てはまる手が無く、CPU に任せた回数
  latencySumMs: number;
  latencySamples: number;
  apiCalls: number;
}

export function createEmptyStats(agent: AgentType): AgentStats {
  return {
    agent,
    matches: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    decisions: 0,
    saves: 0,
    whiffs: 0,
    clamped: 0,
    invalid: 0,
    errors: 0,
    timeouts: 0,
    aimErrorSumDeg: 0,
    aimErrorSamples: 0,
    predictionErrorSumPx: 0,
    predictionSamples: 0,
    cpuTakeovers: 0,
    latencySumMs: 0,
    latencySamples: 0,
    apiCalls: 0,
  };
}

/** エージェント種別 (人間 / CPU / Jev / Gemini / Claude) */
export enum AgentType {
  HUMAN = "HUMAN",
  CPU = "CPU",
  JEV = "JEV",
  GEMINI = "GEMINI",
  CLAUDE = "CLAUDE",
}

/** エージェントのビジュアル & 思考プロファイル */
export interface AgentProfile {
  type: AgentType;
  displayName: string;
  subtitle: string;
  primaryColor: string;
  secondaryColor: string;
  glowColor: string;
}

export const AGENT_PROFILES: Record<AgentType, AgentProfile> = {
  [AgentType.HUMAN]: {
    type: AgentType.HUMAN,
    displayName: "PLAYER (HUMAN)",
    subtitle: "人間のプレイヤー",
    primaryColor: "#00f0ff",
    secondaryColor: "#0088ff",
    glowColor: "rgba(0, 240, 255, 0.4)",
  },
  [AgentType.CPU]: {
    type: AgentType.CPU,
    displayName: "CPU (GEOMETRIC)",
    subtitle: "内蔵の幾何解ソルバー (対照群)",
    primaryColor: "#fbbf24",
    secondaryColor: "#d97706",
    glowColor: "rgba(251, 191, 36, 0.4)",
  },
  [AgentType.JEV]: {
    type: AgentType.JEV,
    displayName: "JEV (SYSTEM ONE)",
    subtitle: "TypeSafe Jev クラウドAPI",
    primaryColor: "#ff0055",
    secondaryColor: "#ff00aa",
    glowColor: "rgba(255, 0, 85, 0.4)",
  },
  [AgentType.GEMINI]: {
    type: AgentType.GEMINI,
    displayName: "GEMINI",
    subtitle: "Google Gemini クラウドAPI",
    primaryColor: "#388bfd",
    secondaryColor: "#8957e5",
    glowColor: "rgba(56, 139, 253, 0.4)",
  },
  [AgentType.CLAUDE]: {
    type: AgentType.CLAUDE,
    displayName: "CLAUDE",
    subtitle: "Anthropic Claude クラウドAPI",
    primaryColor: "#d97706",
    secondaryColor: "#f59e0b",
    glowColor: "rgba(217, 119, 6, 0.4)",
  },
};
