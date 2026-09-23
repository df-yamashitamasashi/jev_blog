/**
 * Playbook (作戦) — Clean Architecture - Domain Layer
 *
 * 試合開始前の「作戦タイム」に、各エージェントが自分で立てる打ち方の約束事。
 * イメージトレーニングのように、起こりうる局面ごとに「どう打つか」を決めておく。
 *
 * 使われる場面:
 *   - 中央線での判断が通信失敗・時間切れ・応答不正で得られなかったとき
 *     → 「相手から来るパック」の作戦 (incoming) で打つ
 *   - パックが自陣に2秒以上留まっているとき (中央線を越えないので判断の機会が無い)
 *     → 「自陣に居座るパック」の作戦 (lingering) で打つ
 *
 * どちらもエージェント自身が事前に決めた作戦なので、ローカルの戦術 (CPU モード) で
 * 肩代わりしていることにはならない。局面の分類と、作戦を座標へ落とす変換は全エージェント
 * 共通の機械的な規則で、どこを狙い・いつ打つかの判断は一切含まない。
 */

import { Vec2 } from "./physics";
import { StadiumConfig } from "./gameState";
import { PlaySide, malletYRange, validateShotPlan } from "./shotPlanValidator";
import { ShotPlan } from "./jevAgentTypes";
import { PuckTrajectory } from "./puckPredictor";
import { MalletLimits, travelTime } from "./interception";

/** 相手から来るパックの局面 (中央線を越えた瞬間に分類する) */
export const INCOMING_SITUATIONS = [
  "THREAT_FAST",     // 自陣ゴールへ入る軌道の速い球
  "THREAT_SLOW",     // 自陣ゴールへ入る軌道の遅い球
  "BANK_FROM_LEFT",  // 自陣で左の側壁に当たってから来る球
  "BANK_FROM_RIGHT", // 自陣で右の側壁に当たってから来る球
  "FAST_LEFT",       // 左寄りを来る速い球 (ゴールには入らない)
  "FAST_CENTER",     // 中央を来る速い球
  "FAST_RIGHT",      // 右寄りを来る速い球
  "SLOW_LEFT",       // 左寄りを来る遅い球
  "SLOW_CENTER",     // 中央を来る遅い球
  "SLOW_RIGHT",      // 右寄りを来る遅い球
] as const;

/** 自陣に2秒以上留まっているパックの局面 */
export const LINGERING_SITUATIONS = [
  "ROLLING_TO_GOAL",    // 自陣ゴールへ向かって転がっている
  "NEAR_GOAL",          // 自陣ゴール前 (ゴール幅の内側) に居る
  "CORNER_LEFT",        // 自陣の左奥の隅
  "CORNER_RIGHT",       // 自陣の右奥の隅
  "STOPPED_LEFT",       // 左寄りでほぼ止まっている
  "STOPPED_CENTER",     // 中央付近でほぼ止まっている
  "STOPPED_RIGHT",      // 右寄りでほぼ止まっている
  "WALL_SHUTTLE_LEFT",  // 左の側壁沿いを往復している
  "WALL_SHUTTLE_RIGHT", // 右の側壁沿いを往復している
  "MOVING_OPEN",        // 自陣の開けた場所を動き回っている
] as const;

export type IncomingSituation = (typeof INCOMING_SITUATIONS)[number];
export type LingeringSituation = (typeof LINGERING_SITUATIONS)[number];

export const PLAYBOOK_AIMS = [
  "GOAL_LEFT",
  "GOAL_CENTER",
  "GOAL_RIGHT",
  "BANK_LEFT",
  "BANK_RIGHT",
  "CLEAR",
  "AWAY_FROM_OPPONENT",
] as const;
export type PlaybookAim = (typeof PLAYBOOK_AIMS)[number];

/** 軌道上のどのあたりで打つか。届く最初の点 / その少し後 / さらに引きつけて */
export const PLAYBOOK_DEPTHS = ["EARLY", "MID", "LATE"] as const;
export type PlaybookDepth = (typeof PLAYBOOK_DEPTHS)[number];

export const PLAYBOOK_PATHS = ["STRAIGHT", "CURVE_LEFT", "CURVE_RIGHT"] as const;
export type PlaybookPath = (typeof PLAYBOOK_PATHS)[number];

/**
 * CPU代行のときの CPU の動作パターン。作戦タイムに AI 自身が1つ選ぶ。
 * 作戦に当てはまる手が無い局面では、CPU がこのパターンで判断する。
 */
export const CPU_STYLES = [
  "BALANCED",         // 標準。得点・安全・相手の届きにくさを総合で判断
  "ATTACK_FIRST",     // 攻撃優先。決まる球を大きく評価し、逃がすだけの球は選ばない
  "DEFENSE_FIRST",    // 防御優先。ゴールへ来る球は進路を塞ぎ、打つときは大きく逃がす
  "COUNTER",          // カウンター。できるだけ早い打点で相手の体勢が整う前に返す
  "PATIENT",          // 引きつけ。遅めの打点・壁の跳ね返りを待ってから打つ
  "BANK_SHOOTER",     // バンク重視。側壁を使ったシュートを優先
  "STRAIGHT_SHOOTER", // 直線重視。ゴールへ直接のシュートだけを狙う
  "SAFE_CLEAR",       // 安全第一。常に相手から遠い奥へ逃がす
  "POWER",            // 強打。常に全力で振り、相手ゴール中央付近を狙う
  "SOFT_CONTROL",     // 軟打。弱めに振って、相手マレットの逆へ置きにいく
] as const;
export type CpuStyle = (typeof CPU_STYLES)[number];

/** 1つの局面に対する打ち方 */
export interface PlaybookMove {
  strikeTiming: "DIRECT" | "REBOUND";
  depth: PlaybookDepth;
  aim: PlaybookAim;
  /** 構え位置までの経路。左右は画面上の向き */
  path: PlaybookPath;
  moveSpeed: number;
  swingSpeed: number;
}

export interface Playbook {
  /** 計画が無いときに待つ位置 */
  readyPosition: Vec2;
  /** 作戦に当てはまる手が無い局面を任せるときの CPU の動作パターン */
  cpuStyle: CpuStyle;
  incoming: Partial<Record<IncomingSituation, PlaybookMove>>;
  lingering: Partial<Record<LingeringSituation, PlaybookMove>>;
  /** 作戦全体の方針 (HUD表示用) */
  summary?: string;
}

/** 局面を分けるしきい値。全エージェント共通 */
const FAST_PUCK_SPEED = 1200;
const STOPPED_PUCK_SPEED = 80;
const DEEP_ZONE_PX = 170;

/** 自陣にこの秒数以上留まったパックは「居座る球」として作戦で打ちに行く */
export const LINGER_THRESHOLD_SEC = 2.0;

/** 作戦から打点を選ぶ: MID / LATE は届く最初の点からこの秒数だけ引きつける */
const DEPTH_DELAY_SEC: Record<PlaybookDepth, number> = { EARLY: 0, MID: 0.15, LATE: 0.3 };

/** 構え位置で振りかぶるのに使う時間 (秒) */
const SETUP_SEC = 0.1;

/** 曲線のふくらみ (px) */
const PLAYBOOK_CURVE_OFFSET = 90;

function lane(x: number, config: StadiumConfig): "LEFT" | "CENTER" | "RIGHT" {
  if (x < config.width / 3) return "LEFT";
  if (x > (config.width * 2) / 3) return "RIGHT";
  return "CENTER";
}

function inOwnHalf(y: number, side: PlaySide, config: StadiumConfig): boolean {
  return side === "TOP" ? y <= config.height * 0.5 : y >= config.height * 0.5;
}

/** 自陣ゴールラインからの深さ (px) */
function depthFromOwnGoal(y: number, side: PlaySide, config: StadiumConfig): number {
  return side === "TOP" ? y : config.height - y;
}

/** 中央線を越えてきたパックの局面を分類する */
export function classifyIncoming(
  traj: PuckTrajectory,
  puckVel: Vec2,
  side: PlaySide,
  config: StadiumConfig
): IncomingSituation {
  const speed = puckVel.mag();
  if (traj.goalConcededBy === side) return speed >= FAST_PUCK_SPEED ? "THREAT_FAST" : "THREAT_SLOW";

  // 自陣の側壁で跳ね返ってから来るか。奥壁に当たった後の跳ね返りは、もう「来る球」ではない
  for (const t of traj.bounceTimes) {
    const i = Math.min(traj.samples.length - 1, Math.round(t / traj.dt));
    const s = traj.samples[i];
    // 跳ね返り直後のサンプルは壁から最大で1ステップ分 (高速時 8px 程度) 離れている
    const atEndWall = s.pos.y <= config.puckRadius + 10 || s.pos.y >= config.height - config.puckRadius - 10;
    if (atEndWall) break;
    if (!inOwnHalf(s.pos.y, side, config)) continue;
    if (s.pos.x <= config.puckRadius + 10) return "BANK_FROM_LEFT";
    if (s.pos.x >= config.width - config.puckRadius - 10) return "BANK_FROM_RIGHT";
  }

  const x = traj.samples[0].pos.x;
  const l = lane(x, config);
  if (speed >= FAST_PUCK_SPEED) return l === "LEFT" ? "FAST_LEFT" : l === "RIGHT" ? "FAST_RIGHT" : "FAST_CENTER";
  return l === "LEFT" ? "SLOW_LEFT" : l === "RIGHT" ? "SLOW_RIGHT" : "SLOW_CENTER";
}

/** 自陣に居座るパックの局面を分類する */
export function classifyLingering(
  traj: PuckTrajectory,
  puckPos: Vec2,
  puckVel: Vec2,
  side: PlaySide,
  config: StadiumConfig
): LingeringSituation {
  if (traj.goalConcededBy === side) return "ROLLING_TO_GOAL";

  const l = lane(puckPos.x, config);
  const deep = depthFromOwnGoal(puckPos.y, side, config) < DEEP_ZONE_PX;
  if (deep) {
    if (Math.abs(puckPos.x - config.width / 2) <= config.goalWidth / 2) return "NEAR_GOAL";
    return puckPos.x < config.width / 2 ? "CORNER_LEFT" : "CORNER_RIGHT";
  }

  if (puckVel.mag() < STOPPED_PUCK_SPEED) {
    return l === "LEFT" ? "STOPPED_LEFT" : l === "RIGHT" ? "STOPPED_RIGHT" : "STOPPED_CENTER";
  }

  const alongWall = Math.abs(puckVel.y) > Math.abs(puckVel.x);
  if (alongWall && puckPos.x < config.width * 0.25) return "WALL_SHUTTLE_LEFT";
  if (alongWall && puckPos.x > config.width * 0.75) return "WALL_SHUTTLE_RIGHT";
  return "MOVING_OPEN";
}

/** 狙いの種類を座標へ。LLM に説明している狙い方 (ゴール・壁の鏡像) と同じ */
export function aimPointFor(
  aim: PlaybookAim,
  side: PlaySide,
  config: StadiumConfig,
  opponentMalletPos: Vec2
): Vec2 {
  const netY = side === "TOP" ? config.height + 30 : -30;
  const center = config.width * 0.5;
  const reach = config.goalWidth * 0.5 - config.puckRadius * 1.2;
  const leftWall = config.puckRadius;
  const rightWall = config.width - config.puckRadius;
  const awayRight = opponentMalletPos.x <= center;

  switch (aim) {
    case "GOAL_LEFT":
      return new Vec2(center - reach, netY);
    case "GOAL_RIGHT":
      return new Vec2(center + reach, netY);
    case "BANK_LEFT":
      return new Vec2(2 * leftWall - center, netY);
    case "BANK_RIGHT":
      return new Vec2(2 * rightWall - center, netY);
    case "CLEAR":
      return new Vec2(awayRight ? config.width : 0, side === "TOP" ? config.height * 0.85 : config.height * 0.15);
    case "AWAY_FROM_OPPONENT":
      return new Vec2(awayRight ? center + reach : center - reach, netY);
    case "GOAL_CENTER":
    default:
      return new Vec2(center, netY);
  }
}

/**
 * 画面上の左右で指定された曲線を、進行方向に対する curveOffset の符号へ直す。
 * 進行方向の右手は画面座標系で (-dy, dx)。
 */
export function screenCurveOffset(path: PlaybookPath, from: Vec2, to: Vec2, magnitude = PLAYBOOK_CURVE_OFFSET): number {
  if (path === "STRAIGHT") return 0;
  const rightHandX = -(to.y - from.y);
  const bulgeX = path === "CURVE_LEFT" ? -1 : 1;
  return (bulgeX * rightHandX >= 0 ? 1 : -1) * magnitude;
}

/**
 * 作戦の1手を、いまの軌道に当てはめて ShotPlan にする。
 *
 * 規則は機械的:
 *   1. 打つ時間帯 — DIRECT なら最初の壁バウンドより前、REBOUND なら後
 *   2. その中で、自陣にあり、作戦の移動速度で構えが間に合う最初の点を探す
 *   3. depth の分だけ引きつけた点を打点にする
 *   4. 打点 = パック中心 − 狙いへの単位ベクトル × 接触距離 (LLM に説明している式)
 * 間に合う点が無ければ、最も惜しい点へ向かう (必ず打ちに行く)。
 */
export function moveToPlan(
  move: PlaybookMove,
  traj: PuckTrajectory,
  malletPos: Vec2,
  side: PlaySide,
  limits: MalletLimits,
  config: StadiumConfig,
  opponentMalletPos: Vec2,
  label: string
): ShotPlan | null {
  const contactDist = config.puckRadius + config.malletRadius;
  const aimPoint = aimPointFor(move.aim, side, config, opponentMalletPos);
  const firstBounce = traj.bounceTimes[0] ?? null;
  const rebound = move.strikeTiming === "REBOUND" && firstBounce !== null;
  const moveSpeed = Math.min(limits.maxSpeed, Math.max(100, move.moveSpeed));

  const candidates: Array<{ t: number; pos: Vec2; slack: number }> = [];
  for (const s of traj.samples) {
    if (s.t < 0.05) continue;
    if (rebound ? s.t <= firstBounce! : firstBounce !== null && s.t >= firstBounce) continue;
    if (!inOwnHalf(s.pos.y, side, config)) continue;
    if (traj.goalAt !== null && s.t >= traj.goalAt) break;

    const toAim = aimPoint.sub(s.pos);
    if (toAim.magSq() < 1e-6) continue;
    const contact = s.pos.sub(toAim.normalize().scale(contactDist));
    const need = travelTime(contact.dist(malletPos), 0, moveSpeed, limits.maxAccel) + SETUP_SEC;
    candidates.push({ t: s.t, pos: s.pos, slack: s.t - need });
  }

  // DIRECT の窓に自陣の点が無い (すぐ跳ね返る) なら、跳ね返りの後で打つしかない
  if (candidates.length === 0 && !rebound && firstBounce !== null) {
    return moveToPlan({ ...move, strikeTiming: "REBOUND" }, traj, malletPos, side, limits, config, opponentMalletPos, label);
  }
  if (candidates.length === 0) return null;

  const firstReachable = candidates.find((c) => c.slack >= 0);
  let chosen: { t: number; pos: Vec2 };
  if (firstReachable) {
    const target = firstReachable.t + DEPTH_DELAY_SEC[move.depth];
    chosen = [...candidates].reverse().find((c) => c.t <= target) ?? firstReachable;
  } else {
    chosen = candidates.reduce((a, b) => (b.slack > a.slack ? b : a));
  }

  const dir = aimPoint.sub(chosen.pos).normalize();
  const intercept = chosen.pos.sub(dir.scale(contactDist));

  const { plan } = validateShotPlan(
    {
      interceptPoint: { x: intercept.x, y: intercept.y },
      contactTimeMs: chosen.t * 1000,
      strikeTiming: rebound || (firstBounce !== null && chosen.t > firstBounce) ? "REBOUND" : "DIRECT",
      swingDirDeg: (Math.atan2(dir.y, dir.x) * 180) / Math.PI,
      swingSpeed: move.swingSpeed,
      movePath: move.path === "STRAIGHT" ? "STRAIGHT" : "CURVE",
      curveOffset: screenCurveOffset(move.path, malletPos, intercept),
      moveSpeed,
      aimPoint: { x: aimPoint.x, y: aimPoint.y },
      comment: `[作戦] ${label}`,
    },
    side,
    config
  );
  return plan;
}

// ─── 検証 (ガードレール) ─────────────────────────────────

/** 作戦の移動速度の下限 (px/s)。これより遅いと構えが事実上間に合わない */
export const MIN_PLAYBOOK_MOVE_SPEED = 150;

export interface PlaybookValidation {
  /** 抜け漏れの無い作戦。1つでも欠けていれば null (作戦として受け付けない) */
  playbook: Playbook | null;
  /** 抜け漏れ・不正な項目。1件でもあれば作戦は不合格 (作り直しを求める) */
  issues: string[];
  /** 範囲外のため丸めた項目 (作戦としては受け付ける。記録だけ残す) */
  notes: string[];
}

const MOVE_FIELDS = ["strikeTiming", "depth", "aim", "path", "moveSpeed", "swingSpeed"] as const;

function pickEnum<T extends string>(value: unknown, options: readonly T[]): T | null {
  return typeof value === "string" && (options as readonly string[]).includes(value) ? (value as T) : null;
}

function readSpeed(
  value: unknown,
  min: number,
  max: number,
  label: string,
  issues: string[],
  notes: string[]
): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issues.push(`${label} が数値ではない`);
    return null;
  }
  const clamped = Math.max(min, Math.min(max, value));
  if (clamped !== value) notes.push(`${label}: ${Math.round(value)} → ${Math.round(clamped)}`);
  return clamped;
}

function readMove(raw: unknown, label: string, config: StadiumConfig, issues: string[], notes: string[]): PlaybookMove | null {
  if (!raw || typeof raw !== "object") {
    issues.push(`${label} が無い`);
    return null;
  }
  const r = raw as Record<string, unknown>;
  const before = issues.length;

  const missing = MOVE_FIELDS.filter((f) => r[f] === undefined || r[f] === null);
  if (missing.length > 0) issues.push(`${label} に ${missing.join(", ")} が無い`);

  const strikeTiming = pickEnum(r.strikeTiming, ["DIRECT", "REBOUND"] as const);
  const depth = pickEnum(r.depth, PLAYBOOK_DEPTHS);
  const aim = pickEnum(r.aim, PLAYBOOK_AIMS);
  const path = pickEnum(r.path, PLAYBOOK_PATHS);
  if (r.strikeTiming !== undefined && !strikeTiming) issues.push(`${label}.strikeTiming が選択肢に無い (${String(r.strikeTiming)})`);
  if (r.depth !== undefined && !depth) issues.push(`${label}.depth が選択肢に無い (${String(r.depth)})`);
  if (r.aim !== undefined && !aim) issues.push(`${label}.aim が選択肢に無い (${String(r.aim)})`);
  if (r.path !== undefined && !path) issues.push(`${label}.path が選択肢に無い (${String(r.path)})`);

  const moveSpeed =
    r.moveSpeed === undefined ? null : readSpeed(r.moveSpeed, MIN_PLAYBOOK_MOVE_SPEED, config.maxMalletSpeed, `${label}.moveSpeed`, issues, notes);
  const swingSpeed =
    r.swingSpeed === undefined ? null : readSpeed(r.swingSpeed, 1, config.maxMalletSpeed, `${label}.swingSpeed`, issues, notes);

  if (issues.length > before || !strikeTiming || !depth || !aim || !path || moveSpeed === null || swingSpeed === null) {
    return null;
  }
  return { strikeTiming, depth, aim, path, moveSpeed, swingSpeed };
}

/**
 * 局面ごとの打ち方を「局面名 → 打ち方」の形にそろえる。
 * LLM は構造化出力の都合で配列 ([{ situation, ... }]) で返し、CPU・Jev はオブジェクトで返す。
 * 配列で同じ局面が2回出てきたら、どちらを採るかをローカルで決めずに不合格にする。
 */
function movesByName(raw: unknown, group: string, issues: string[]): Record<string, unknown> {
  if (Array.isArray(raw)) {
    const byName: Record<string, unknown> = {};
    raw.forEach((item, i) => {
      const name = item && typeof item === "object" ? (item as { situation?: unknown }).situation : undefined;
      if (typeof name !== "string") {
        issues.push(`${group}[${i}] に situation が無い`);
        return;
      }
      if (name in byName) issues.push(`${group}.${name} が重複している`);
      else byName[name] = item;
    });
    return byName;
  }
  return (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
}

/**
 * エージェントが返した作戦を検証する (作戦のガードレール)。
 *
 * 20局面すべての打ち方と待機位置が揃っていなければ不合格にする。欠けた局面を
 * ローカルで補うと、その局面を CPU が決めたことになるし、欠けたまま試合に出すと
 * 通信失敗のたびにそのAIが何もできなくなる。不合格の理由は issues に列挙し、
 * 作戦タイム中の作り直し ([[agentBrainUseCase]] の preparePlaybook) に渡す。
 *
 * 範囲外の速度・自陣の外の待機位置は丸めて受け付け、notes に記録する
 * (判断の ShotPlan と同じ扱い)。
 */
export function validatePlaybook(raw: unknown, side: PlaySide, config: StadiumConfig): PlaybookValidation {
  if (!raw || typeof raw !== "object") {
    return { playbook: null, issues: ["作戦がオブジェクトではない"], notes: [] };
  }
  const r = raw as Record<string, unknown>;
  const issues: string[] = [];
  const notes: string[] = [];

  const incoming: Playbook["incoming"] = {};
  const inRaw = movesByName(r.incoming, "incoming", issues);
  for (const key of INCOMING_SITUATIONS) {
    const move = readMove(inRaw[key], `incoming.${key}`, config, issues, notes);
    if (move) incoming[key] = move;
  }

  const lingering: Playbook["lingering"] = {};
  const lgRaw = movesByName(r.lingering, "lingering", issues);
  for (const key of LINGERING_SITUATIONS) {
    const move = readMove(lgRaw[key], `lingering.${key}`, config, issues, notes);
    if (move) lingering[key] = move;
  }

  // 知らない局面名は、書き間違い (= 本来の局面が抜けている) の可能性が高い
  for (const key of Object.keys(inRaw)) {
    if (!(INCOMING_SITUATIONS as readonly string[]).includes(key)) issues.push(`incoming.${key} は存在しない局面`);
  }
  for (const key of Object.keys(lgRaw)) {
    if (!(LINGERING_SITUATIONS as readonly string[]).includes(key)) issues.push(`lingering.${key} は存在しない局面`);
  }

  const [minY, maxY] = malletYRange(side, config);
  const ready = r.readyPosition as { x?: unknown; y?: unknown } | undefined;
  let readyPosition: Vec2 | null = null;
  if (!ready || typeof ready !== "object") {
    issues.push("readyPosition が無い");
  } else {
    const rx = readSpeed(ready.x, config.malletRadius, config.width - config.malletRadius, "readyPosition.x", issues, notes);
    const ry = readSpeed(ready.y, minY, maxY, "readyPosition.y", issues, notes);
    if (rx !== null && ry !== null) readyPosition = new Vec2(rx, ry);
  }

  const cpuStyle = pickEnum(r.cpuStyle, CPU_STYLES);
  if (r.cpuStyle === undefined || r.cpuStyle === null) issues.push("cpuStyle が無い");
  else if (!cpuStyle) issues.push(`cpuStyle が選択肢に無い (${String(r.cpuStyle)})`);

  if (issues.length > 0 || !readyPosition || !cpuStyle) return { playbook: null, issues, notes };

  const summary = typeof r.summary === "string" ? r.summary.trim().slice(0, 80) : undefined;
  return { playbook: { readyPosition, cpuStyle, incoming, lingering, summary }, issues, notes };
}

export function countMoves(pb: Playbook): number {
  return Object.keys(pb.incoming).length + Object.keys(pb.lingering).length;
}
