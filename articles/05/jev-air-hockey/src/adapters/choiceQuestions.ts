/**
 * Choice Questions — 全エージェント共通の選択式の問い (Clean Architecture - Adapter Layer)
 *
 * 打ち返し計画と作戦を、座標や角度を書かせるのではなく「選択」の組み合わせとして問う。
 * Jev System One は choice / score / noul の問いにしか答えられないので、元々この形で
 * 問うていた。Claude・Gemini にも同じ問い・同じ選択肢を出す ([[llmChoiceProtocol]])。
 *   - 同じ問いに答えさせるので、エージェント間の比較が公平になる
 *   - 答えが選択肢の中からしか選べないので、抜け漏れ・不正を機械的に検出できる
 *   - 自由記述の巨大なスキーマを避けられる (Claude の構造化出力が 400 で拒否した)
 *
 *   contact  — 軌道予測のどの時点・どの位置で打つか (= 予測そのもの)
 *   aim      — どこへ飛ばすか (ゴール左/中央/右・左右のバンク・クリア)
 *   path     — 構え位置まで直線か、左右どちらへ曲線で回り込むか
 *   speed    — 移動速度の段階
 *   power    — スイングの強さの段階
 *
 * 渡す情報は LLM 勢と同じ (現在の盤面と、同じ刻みの軌道予測)。選んだ点と狙いから
 * 打点・振り抜き方向を出す式も、LLM のプロンプトで説明しているものと同じ
 * (打点 = パック中心 − 狙いへの単位ベクトル × 接触距離)。入射球の運動量による
 * ずれの補正などはしないので、選択の良し悪しがそのまま結果に出る。
 */

import { Vec2 } from "../domain/physics";
import { AirHockeyObservation } from "./agentClient";
import { predictPuckPath } from "../domain/puckPredictor";
import {
  INCOMING_SITUATIONS,
  LINGERING_SITUATIONS,
  PLAYBOOK_AIMS,
  aimPointFor,
  screenCurveOffset,
} from "../domain/playbook";
import { PlaybookContext } from "./agentClient";
import { AIM_DESCRIPTIONS, CPU_STYLE_DESCRIPTIONS, INCOMING_DESCRIPTIONS, LINGERING_DESCRIPTIONS } from "./llmShotPlanner";

/** 打点候補として提示する軌道予測の刻み (LLM のプロンプトと同じ) */
const FORECAST_STEP_SEC = 0.1;
const FORECAST_HORIZON_SEC = 1.6;

/** 構え位置への移動速度の段階 (px/s) */
export const MOVE_SPEED_LEVELS = [450, 600, 750, 900, 1050];
/** スイングの強さの段階 (px/s) */
export const SWING_SPEED_LEVELS = [450, 650, 850, 1050];
/** CURVE のふくらみ (px) */
const CURVE_OFFSET_PX = 90;

type AimKey = (typeof PLAYBOOK_AIMS)[number];
type PathKey = "STRAIGHT" | "CURVE_LEFT" | "CURVE_RIGHT";

export interface ChoiceQuestion {
  type: "choice" | "score";
  instructions: string;
  criteria: Record<string, string> | string[];
}

export interface QuestionSet {
  model: string;
  state: Record<string, unknown>;
  questions: Record<string, ChoiceQuestion>;
}

interface ContactOption {
  key: string;
  t: number;
  pos: Vec2;
  rebound: boolean;
}

/** 盤面から、Jev に投げる問いと、答えを計画へ戻すための材料を作る */
export function buildShotQuestions(obs: AirHockeyObservation, model = "jev-latest") {
  const { config, side } = obs;
  const traj = predictPuckPath(obs.puckPos, obs.puckVel, config, { horizonSec: FORECAST_HORIZON_SEC });
  const firstBounce = traj.bounceTimes[0] ?? Number.POSITIVE_INFINITY;
  const stride = Math.max(1, Math.round(FORECAST_STEP_SEC / traj.dt));
  const inMyHalf = (y: number) => (side === "TOP" ? y <= config.height * 0.5 : y >= config.height * 0.5);

  const contacts: ContactOption[] = [];
  for (let i = stride; i < traj.samples.length; i += stride) {
    const s = traj.samples[i];
    if (!inMyHalf(s.pos.y)) continue;
    contacts.push({ key: `t${Math.round(s.t * 1000)}`, t: s.t, pos: s.pos, rebound: s.t > firstBounce });
  }

  const round = (n: number) => Math.round(n);
  const contactCriteria: Record<string, string> = {};
  for (const c of contacts) {
    contactCriteria[c.key] =
      `${round(c.t * 1000)}ms後、パック中心 (${round(c.pos.x)}, ${round(c.pos.y)}) で当てる` +
      (c.rebound ? " (壁で跳ね返った後の球)" : " (飛んでくる球をそのまま)");
  }

  const myGoalY = side === "TOP" ? 0 : config.height;
  const opponentGoalY = side === "TOP" ? config.height : 0;

  const state = {
    role: "air_hockey_striker",
    note: "パックが中央線を越えて自陣に入った瞬間。判断はこの1回だけで、実行中に打点は補正されない",
    side,
    court: { width: config.width, height: config.height, goalMouthX: [round((config.width - config.goalWidth) / 2), round((config.width + config.goalWidth) / 2)] },
    myGoalY,
    opponentGoalY,
    puck: { pos: [round(obs.puckPos.x), round(obs.puckPos.y)], vel: [round(obs.puckVel.x), round(obs.puckVel.y)] },
    myMallet: { pos: [round(obs.myMalletPos.x), round(obs.myMalletPos.y)], vel: [round(obs.myMalletVel.x), round(obs.myMalletVel.y)] },
    opponentMallet: { pos: [round(obs.opponentMalletPos.x), round(obs.opponentMalletPos.y)] },
    score: { me: obs.myScore, opponent: obs.opponentScore },
    malletLimits: { maxSpeed: config.maxMalletSpeed, maxAccel: config.maxMalletAccel },
    forecast: traj.samples
      .filter((_, i) => i % stride === 0)
      .map((s) => ({ ms: round(s.t * 1000), pos: [round(s.pos.x), round(s.pos.y)] })),
    goalConcededInMs:
      traj.goalConcededBy === side && traj.goalAt !== null ? round(traj.goalAt * 1000) : null,
  };

  const questions: Record<string, ChoiceQuestion> = {
    contact: {
      type: "choice",
      instructions:
        "自分のマレットがその時刻までに届き、振りかぶる余裕 (約0.1秒) も残る打点を選ぶ。遅すぎればゴールを割られ、早すぎれば間に合わない。ゴールに向かわない球 (壁沿いの往復など) も必ず打ちに行く",
      criteria: contactCriteria,
    },
    aim: {
      type: "choice",
      instructions: "パックをどこへ飛ばすか。相手マレットから遠い側ほど決まりやすい。壁際の球は壁の向こうの鏡像を狙うバンクでしか前へ飛ばせない",
      criteria: AIM_DESCRIPTIONS,
    },
    path: {
      type: "choice",
      instructions: "構え位置 (打点の手前) までの動き方。直線上をパックが横切るなら曲線で避ける",
      criteria: {
        STRAIGHT: "直線で向かう",
        CURVE_LEFT: "左へふくらむ曲線で回り込む",
        CURVE_RIGHT: "右へふくらむ曲線で回り込む",
      },
    },
    speed: {
      type: "score",
      instructions: "構え位置へ向かう移動速度。遠い打点ほど速く、近い打点は遅くても間に合う",
      criteria: MOVE_SPEED_LEVELS.map((v) => `${v} px/s`),
    },
    power: {
      type: "score",
      instructions: "スイングの強さ。強いほど球が速く、飛んでくる球の勢いに負けずに向きを変えられる",
      criteria: SWING_SPEED_LEVELS.map((v) => `${v} px/s`),
    },
  };

  const request: QuestionSet = { model, state, questions };
  return { request, contacts };
}

/**
 * Jev の答えを、他のエージェントと同じ ShotPlan の生データへ戻す。
 * 答えが欠けている・選択肢に無い場合は null (= INVALID として記録)。
 */
export function answersToRawPlan(
  answers: unknown,
  obs: AirHockeyObservation,
  contacts: ContactOption[]
): Record<string, unknown> | null {
  if (!answers || typeof answers !== "object") return null;
  const a = answers as Record<string, { choice?: unknown; score?: unknown } | undefined>;
  const { config, side } = obs;

  const contact = contacts.find((c) => c.key === a.contact?.choice);
  const aimKey = a.aim?.choice as AimKey | undefined;
  const pathKey = a.path?.choice as PathKey | undefined;
  if (!contact || !aimKey || !pathKey) return null;

  if (!(PLAYBOOK_AIMS as readonly string[]).includes(aimKey)) return null;
  const aimPoint = aimPointFor(aimKey, side, config, obs.opponentMalletPos);

  // LLM のプロンプトと同じ式: 打点 = パック中心 − 狙いへの単位ベクトル × 接触距離
  const toAim = aimPoint.sub(contact.pos);
  if (toAim.magSq() < 1e-6) return null;
  const dir = toAim.normalize();
  const intercept = contact.pos.sub(dir.scale(config.puckRadius + config.malletRadius));

  const level = (score: unknown, table: number[]) => {
    const n = typeof score === "number" && Number.isFinite(score) ? Math.round(score) : table.length - 1;
    return table[Math.max(0, Math.min(table.length - 1, n))];
  };

  // 曲線の左右は画面上の向き。進行方向に対する右/左 (curveOffset の符号) へ直す
  const curveOffset = screenCurveOffset(pathKey, obs.myMalletPos, intercept, CURVE_OFFSET_PX);

  return {
    interceptPoint: { x: intercept.x, y: intercept.y },
    contactTimeMs: contact.t * 1000,
    strikeTiming: contact.rebound ? "REBOUND" : "DIRECT",
    swingDirDeg: (Math.atan2(dir.y, dir.x) * 180) / Math.PI,
    swingSpeed: level(a.power?.score, SWING_SPEED_LEVELS),
    movePath: pathKey === "STRAIGHT" ? "STRAIGHT" : "CURVE",
    curveOffset,
    moveSpeed: level(a.speed?.score, MOVE_SPEED_LEVELS),
    aimPoint: { x: aimPoint.x, y: aimPoint.y },
    comment: `${Math.round(contact.t * 1000)}ms後 / ${aimKey}`,
  };

}

// ─── 作戦タイム ─────────────────────────────────────────

const TIMING_OPTIONS: Record<string, string> = {
  DIRECT_EARLY: "飛んでくる球を、構えが間に合う最初の点で打つ",
  DIRECT_MID: "飛んでくる球を、0.15秒引きつけて打つ",
  DIRECT_LATE: "飛んでくる球を、0.3秒引きつけて打つ",
  REBOUND_EARLY: "壁で跳ね返った球を、間に合う最初の点で打つ",
  REBOUND_MID: "壁で跳ね返った球を、0.15秒引きつけて打つ",
  REBOUND_LATE: "壁で跳ね返った球を、0.3秒引きつけて打つ",
};

const READY_OPTIONS = {
  DEEP_CENTER: "自陣ゴール前の中央 (深め)",
  MID_CENTER: "自陣の中央 (やや前)",
  DEEP_LEFT_POST: "自陣ゴール前の左ポスト寄り",
  DEEP_RIGHT_POST: "自陣ゴール前の右ポスト寄り",
  FORWARD_CENTER: "中央線寄りの中央 (前がかり)",
} as const;

function readyPositionFor(key: keyof typeof READY_OPTIONS, ctx: PlaybookContext): { x: number; y: number } {
  const { config, side } = ctx;
  const depth = { DEEP_CENTER: 0.16, MID_CENTER: 0.28, DEEP_LEFT_POST: 0.16, DEEP_RIGHT_POST: 0.16, FORWARD_CENTER: 0.4 }[key];
  const post = config.goalWidth * 0.4;
  const x = key === "DEEP_LEFT_POST" ? config.width / 2 - post : key === "DEEP_RIGHT_POST" ? config.width / 2 + post : config.width / 2;
  return { x, y: side === "TOP" ? config.height * depth : config.height * (1 - depth) };
}

/** 1局面ごとに問う5問のひな形。Jev には局面ごとに展開し、LLM には1回だけ示す */
export const SITUATION_QUESTIONS: Record<"timing" | "aim" | "path" | "speed" | "power", ChoiceQuestion> = {
  timing: { type: "choice", instructions: "いつ打つか", criteria: TIMING_OPTIONS },
  aim: { type: "choice", instructions: "どこへ飛ばすか", criteria: AIM_DESCRIPTIONS },
  path: {
    type: "choice",
    instructions: "構え位置までの経路",
    criteria: { STRAIGHT: "直線", CURVE_LEFT: "画面の左へふくらむ曲線", CURVE_RIGHT: "画面の右へふくらむ曲線" },
  },
  speed: { type: "score", instructions: "構え位置へ向かう速度", criteria: MOVE_SPEED_LEVELS.map((v) => `${v} px/s`) },
  power: { type: "score", instructions: "スイングの強さ", criteria: SWING_SPEED_LEVELS.map((v) => `${v} px/s`) },
};

/** 作戦全体で1回だけ問う2問 */
export const PLAYBOOK_GLOBAL_QUESTIONS: Record<"ready" | "cpu_style", ChoiceQuestion> = {
  ready: { type: "choice", instructions: "計画が無いときにマレットを待たせる位置", criteria: { ...READY_OPTIONS } },
  cpu_style: {
    type: "choice",
    instructions: "作戦どおりに打てない局面を CPU に任せるときの、CPU の動作パターン",
    criteria: CPU_STYLE_DESCRIPTIONS,
  },
};

function situationQuestions(situation: string, description: string): Record<string, ChoiceQuestion> {
  return Object.fromEntries(
    Object.entries(SITUATION_QUESTIONS).map(([k, q]) => [
      `${situation}__${k}`,
      { ...q, instructions: `局面「${description}」: ${q.instructions}` },
    ])
  );
}

/**
 * 作戦タイムの問い。1局面につき5問 x 20局面 + 待機位置 + CPUの動作パターン = 102問になるので、
 * 「相手から来る球」と「自陣に居座る球」の2リクエストに分けて並列に投げる。
 * CPU に任せるときの動作パターン (1問) は前者に含める。
 */
/** 作戦タイムに渡す盤面の前提 (全エージェント共通) */
export function playbookState(ctx: PlaybookContext): Record<string, unknown> {
  const { config, side } = ctx;
  return {
    role: "air_hockey_strategist",
    note:
      "試合開始前の作戦タイム。ここで決めた打ち方は、通信が失敗した局面と、パックが自陣に2秒以上留まる局面で、そのまま実行される",
    side,
    court: { width: config.width, height: config.height },
    myGoalY: side === "TOP" ? 0 : config.height,
    opponentGoalY: side === "TOP" ? config.height : 0,
    malletLimits: { maxSpeed: config.maxMalletSpeed, maxAccel: config.maxMalletAccel },
    targetScore: ctx.targetScore,
    // 作り直しのとき、前回の答えのどこが不合格だったか
    ...(ctx.previousIssues?.length ? { previousIssues: ctx.previousIssues.slice(0, 30) } : {}),
  };
}

export function buildPlaybookQuestions(ctx: PlaybookContext, model = "jev-latest"): QuestionSet[] {
  const state = playbookState(ctx);

  const incoming: Record<string, ChoiceQuestion> = { ...PLAYBOOK_GLOBAL_QUESTIONS };
  for (const s of INCOMING_SITUATIONS) Object.assign(incoming, situationQuestions(s, INCOMING_DESCRIPTIONS[s]));

  const lingering: Record<string, ChoiceQuestion> = {};
  for (const s of LINGERING_SITUATIONS) Object.assign(lingering, situationQuestions(s, LINGERING_DESCRIPTIONS[s]));

  return [
    { model, state: { ...state, phase: "相手から来るパックへの打ち方" }, questions: incoming },
    { model, state: { ...state, phase: "自陣に居座るパックへの打ち方" }, questions: lingering },
  ];
}

/** Jev の答え (2リクエスト分を合わせたもの) を、共通の作戦の生データへ戻す */
export function answersToRawPlaybook(answers: unknown, ctx: PlaybookContext): Record<string, unknown> | null {
  if (!answers || typeof answers !== "object") return null;
  const a = answers as Record<string, { choice?: unknown; score?: unknown } | undefined>;

  const level = (score: unknown, table: number[]) => {
    if (typeof score !== "number" || !Number.isFinite(score)) return undefined;
    return table[Math.max(0, Math.min(table.length - 1, Math.round(score)))];
  };

  const move = (situation: string) => {
    const timing = a[`${situation}__timing`]?.choice;
    if (typeof timing !== "string" || !(timing in TIMING_OPTIONS)) return undefined;
    const [strikeTiming, depth] = timing.split("_");
    return {
      strikeTiming,
      depth,
      aim: a[`${situation}__aim`]?.choice,
      path: a[`${situation}__path`]?.choice,
      moveSpeed: level(a[`${situation}__speed`]?.score, MOVE_SPEED_LEVELS),
      swingSpeed: level(a[`${situation}__power`]?.score, SWING_SPEED_LEVELS),
    };
  };

  const readyKey = a.ready?.choice;
  return {
    summary: "Jev System One の作戦",
    cpuStyle: a.cpu_style?.choice,
    readyPosition:
      typeof readyKey === "string" && readyKey in READY_OPTIONS
        ? readyPositionFor(readyKey as keyof typeof READY_OPTIONS, ctx)
        : undefined,
    incoming: Object.fromEntries(INCOMING_SITUATIONS.map((s) => [s, move(s)])),
    lingering: Object.fromEntries(LINGERING_SITUATIONS.map((s) => [s, move(s)])),
  };
}
