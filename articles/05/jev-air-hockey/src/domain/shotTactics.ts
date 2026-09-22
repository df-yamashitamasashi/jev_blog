/**
 * Shot Candidate Evaluation (Clean Architecture - Domain Layer)
 *
 * 「どこを狙うか」を決めるための候補生成と採点。直接シュート・左右の壁を使った
 * バンクシュート・安全なクリアを同じ物差しで比べる。
 *
 * 採点の根拠は宣言ではなく実測 — 候補ごとに打った後の軌道を実際に積分し、
 * ゴールへ入るか・相手に取られるか・自陣へ返ってくるかを確かめる。
 * これは CPU エージェント (対照群) が使うだけでなく、LLM に渡すプロンプトで
 * 「何を考えるべきか」を説明する際の土台にもなっている。
 */

import { Vec2 } from "./physics";
import { StadiumConfig } from "./gameState";
import { PlaySide } from "./shotPlanValidator";
import { predictPuckPath } from "./puckPredictor";
import {
  InterceptSolution,
  MalletLimits,
  solveIntercept,
  travelTime,
} from "./interception";

export type ShotKind = "DIRECT" | "BANK_LEFT" | "BANK_RIGHT" | "CLEAR";

export interface ShotCandidate {
  kind: ShotKind;
  /** 宣言する狙い座標 (壁を使う場合は壁の向こうの鏡像) */
  aimPoint: Vec2;
  /** 実際に通したい最終地点 (ゴール内の座標) */
  targetPoint: Vec2;
}

export interface ScoredShot {
  candidate: ShotCandidate;
  solution: InterceptSolution;
  score: number;
  /** 打った後、相手ゴールに入るまでの秒数 (入らないなら null) */
  goalInSec: number | null;
  /** 相手が触れるまでの余裕 (秒)。大きいほど取られやすい */
  opponentSlackSec: number;
}

/** 相手ゴールの内側の座標 (ネットの奥) */
function opponentNetY(side: PlaySide, config: StadiumConfig): number {
  return side === "TOP" ? config.height + 30 : -30;
}

/**
 * 狙いの候補を並べる。
 * ゴール幅いっぱいに直接シュートを散らし、さらに左右の壁を使った鏡像も加える。
 * 壁の反射面はパック中心から見て x = puckRadius / width - puckRadius にある。
 */
export function buildShotCandidates(side: PlaySide, config: StadiumConfig): ShotCandidate[] {
  const netY = opponentNetY(side, config);
  const center = config.width * 0.5;
  const half = config.goalWidth * 0.5;

  // ポストの内側を狙う。枠ぎりぎりは外れるので少し内側に入れる
  const inset = config.puckRadius * 1.2;
  const reach = half - inset;
  const offsets = [-reach, -reach * 0.66, -reach * 0.33, 0, reach * 0.33, reach * 0.66, reach];

  const candidates: ShotCandidate[] = offsets.map((dx) => {
    const target = new Vec2(center + dx, netY);
    return { kind: "DIRECT" as ShotKind, aimPoint: target.clone(), targetPoint: target };
  });

  // バンクシュート: 側壁で1回反射させてからゴールへ入れる
  const leftWall = config.puckRadius;
  const rightWall = config.width - config.puckRadius;

  for (const dx of [-(half - inset) * 0.5, 0, (half - inset) * 0.5]) {
    const target = new Vec2(center + dx, netY);
    candidates.push({
      kind: "BANK_LEFT",
      aimPoint: new Vec2(2 * leftWall - target.x, target.y),
      targetPoint: target,
    });
    candidates.push({
      kind: "BANK_RIGHT",
      aimPoint: new Vec2(2 * rightWall - target.x, target.y),
      targetPoint: target,
    });
  }

  return candidates;
}

/**
 * 逃げのクリア候補。相手マレットから遠い側の側壁沿いへ強く逃がす。
 * 得点にはならないが、自陣から確実に追い出せる。
 */
export function buildClearCandidate(
  side: PlaySide,
  config: StadiumConfig,
  opponentMalletPos: Vec2
): ShotCandidate {
  const awayFromOpponent = opponentMalletPos.x > config.width * 0.5 ? 0 : config.width;
  const target = new Vec2(awayFromOpponent, side === "TOP" ? config.height * 0.85 : config.height * 0.15);
  return { kind: "CLEAR", aimPoint: target.clone(), targetPoint: target };
}

/**
 * この局面が「攻撃（シュート）を仕掛けるチャンス」かどうかを判定する。
 *
 * エアホッケーの基本は「守備」。相手陣にある球や、高速で飛んでくる危険な球に対して
 * むやみに前へ飛び出して大振りを狙うと、空振りや失点、自殺点につながる。
 * 以下の条件を満たす「チャンス局面」でのみ攻撃ショットを許容し、
 * それ以外はゴール前でのブロックやセーブ（守備専念）を優先する。
 */
export function isOffensiveOpportunity(
  puckPos: Vec2,
  puckVel: Vec2,
  side: PlaySide,
  config: StadiumConfig,
  solution?: InterceptSolution | null
): boolean {
  const inOwnHalf = side === "TOP" ? puckPos.y <= config.height * 0.52 : puckPos.y >= config.height * 0.48;
  const headingToMe = side === "TOP" ? puckVel.y < -30 : puckVel.y > 30;

  // 1. パックが相手陣にあり、かつ自陣へ向かっていない時は「守り (待機)」の基本姿勢を維持 (攻撃チャンスではない)
  if (!inOwnHalf && !headingToMe) {
    return false;
  }

  // 2. 迎撃解が与えられている場合:
  if (solution) {
    // 実行不能な解は攻撃チャンスではない
    if (!solution.feasible) return false;

    // 自陣ゴールに危険なほど近すぎる打点 (自殺点リスク) は攻撃ではなくブロックに留める
    const dangerGoalMargin = config.malletRadius * 1.6;
    const isDangerZone =
      side === "TOP"
        ? solution.contactPoint.y < dangerGoalMargin
        : solution.contactPoint.y > config.height - dangerGoalMargin;
    if (isDangerZone) return false;

    return true;
  }

  // 自陣にあるか、自陣に向かってきている球は反撃・攻撃のチャンス
  return true;
}

export interface EvaluateContext {
  side: PlaySide;
  config: StadiumConfig;
  limits: MalletLimits;
  malletPos: Vec2;
  malletVel: Vec2;
  opponentMalletPos: Vec2;
  opponentMalletVel: Vec2;
  swingSpeed: number;
  /** 宣言したい迎撃点の好み (無ければ最速の打点) */
  preferPoint?: Vec2;
}

/**
 * 打った後の軌道を実際に積分して、相手にとっての難易度を測る。
 *   slack    — 相手が最も余裕をもって触れるときの余裕 (秒)。小さいほど厳しい
 *   travelPx — そのとき相手が動かされる距離 (px)。大きいほど陣形が崩れる
 */
function opponentPressure(
  postPath: ReturnType<typeof predictPuckPath>,
  ctx: EvaluateContext,
  untilSec: number
): { slackSec: number; travelPx: number } {
  const contactDist = ctx.config.puckRadius + ctx.config.malletRadius;
  let slackSec = Number.NEGATIVE_INFINITY;
  let travelPx = 0;

  for (const sample of postPath.samples) {
    if (sample.t > untilSec) break;

    // 相手の陣地に入ってからが勝負
    const inOpponentHalf =
      ctx.side === "TOP" ? sample.pos.y > ctx.config.height * 0.48 : sample.pos.y < ctx.config.height * 0.52;
    if (!inOpponentHalf) continue;

    const toPuck = sample.pos.sub(ctx.opponentMalletPos);
    const dist = Math.max(0, toPuck.mag() - contactDist);
    const v0 = dist > 1e-6 ? ctx.opponentMalletVel.dot(toPuck.normalize()) : 0;
    const need = travelTime(dist, v0, ctx.limits.maxSpeed, ctx.limits.maxAccel);

    const slack = sample.t - need;
    if (slack > slackSec) {
      slackSec = slack;
      travelPx = dist;
    }
  }

  return slackSec === Number.NEGATIVE_INFINITY ? { slackSec: -1, travelPx: 0 } : { slackSec, travelPx };
}

/**
 * 打った後、パックが自陣へ戻ってくるまでの時間とその速度。
 * 地平線内に戻ってこないなら null (= 相手陣に置いておけた)。
 * 相手が打ち返す想定は含めない — 含めると相手の判断を仮定することになる。
 */
function returnToOwnHalf(
  postPath: ReturnType<typeof predictPuckPath>,
  ctx: EvaluateContext
): { afterSec: number; speed: number } | null {
  for (const sample of postPath.samples) {
    const inOwnHalf =
      ctx.side === "TOP" ? sample.pos.y <= ctx.config.height * 0.52 : sample.pos.y >= ctx.config.height * 0.48;
    // 打った直後は当然まだ自陣にいるので、一度相手陣へ出るまでは数えない
    if (sample.t < 0.12) continue;
    if (inOwnHalf) return { afterSec: sample.t, speed: sample.vel.mag() };
  }
  return null;
}

const GOAL_REWARD = 1200;
const OWN_GOAL_PENALTY = 4000;
const OPPONENT_REACH_PENALTY = 900;
const CONTACT_DELAY_PENALTY = 260;
const NEAR_MISS_REWARD = 380;
/** 枠を捉えてはいるが相手に止められる球の価値 */
const FRAMED_SHOT_REWARD = 150;
/**
 * 決まらない球でも「相手を動かせる球」を選ぶための重み。
 *
 * これが無いと、相手が余裕をもって届く球はどれも同じ評価になり、両者が同じ
 * やり取りを機械的に繰り返す周期に入る (自己対戦でラリー上限600に達して
 * 引き分けになる局面が実際に出た)。取られる前提でも、より遠くへ走らせる球を
 * 選び続ければ陣形が崩れ、いずれ隙ができる。
 */
const OPPONENT_TRAVEL_REWARD = 150;
/**
 * 「相手陣にパックを置いておく」ことの価値。
 *
 * 1手先しか見ない採点だと、最高速で真っ直ぐ打ち返すのが常に最善になる。両者が
 * そう指すと、2000px/s の打球を互いに完璧に返し続ける安定した周期に入り、
 * 1400ラリー・425秒かけても点が動かない局面が実際に発生した。
 * エアホッケーで点が入るのは相手を動かして陣形を崩したときなので、打球が
 * 相手陣に留まる時間を評価し、自陣へ高速で跳ね返ってくる球を嫌う。
 */
const KEEP_AWAY_REWARD = 320;
const RETURN_SPEED_PENALTY = 300;

/** 相手にこれ以上の余裕があるなら、枠に入る軌道でも「止められる球」とみなす */
const SAVEABLE_SLACK_SEC = 0.06;

/** 宣言した狙いと実際の出射方向のずれの許容値 (度) */
const MAX_AIM_ERROR_DEG = 8;

/**
 * 1つの候補を採点する。実行不可能 (間に合わない) 場合は null。
 */
export function evaluateShot(
  traj: ReturnType<typeof predictPuckPath>,
  candidate: ShotCandidate,
  ctx: EvaluateContext,
  maxLookaheadSec: number
): ScoredShot | null {
  const solution = solveIntercept(
    traj,
    ctx.malletPos,
    ctx.malletVel,
    candidate.aimPoint,
    ctx.limits,
    ctx.config,
    {
      swingSpeed: ctx.swingSpeed,
      maxLookaheadSec,
      preferPoint: ctx.preferPoint,
      // サーボ側と同じ基準で「振りかぶれる打点」を選ぶ
      setupSec: ctx.swingSpeed / ctx.limits.maxAccel + 0.04,
      windupPx: Math.min(150, (ctx.swingSpeed * ctx.swingSpeed) / (2 * ctx.limits.maxAccel)),
    }
  );

  if (!solution) return null;

  /**
   * 宣言した狙いを物理的に実現できない解は採用しない。
   *
   * 弱く振ると、飛んでくるパックの運動量が残るぶん出射方向を自由に選べなくなる
   * (2000px/s の球を 300px/s のマレットで真横へ返すことはできない)。ここを
   * 通してしまうと、狙いの宣言と実際の打球が食い違う手を「弱く当てて置く球」
   * として選び続け、宣言と実測の乖離が 43° まで悪化した。
   */
  if (solution.aimErrorDeg > MAX_AIM_ERROR_DEG) return null;

  // 打った直後のパックを、実際の物理で飛ばしてみる
  const postPath = predictPuckPath(solution.puckPosAtContact, solution.predictedPuckVel, ctx.config, {
    horizonSec: 1.8,
    dt: 1 / 120,
  });

  const opponentSide: PlaySide = ctx.side === "TOP" ? "BOTTOM" : "TOP";
  const ownGoal = postPath.goalConcededBy === ctx.side;

  const reachesGoal = postPath.goalConcededBy === opponentSide ? postPath.goalAt : null;
  const pressure = opponentPressure(postPath, ctx, reachesGoal ?? 1.8);

  /**
   * 相手が余裕をもって触れる軌道は、枠に入る計算でも得点にはならない。
   *
   * ここを「枠に入るか」だけで評価していたため、相手が完璧に守れる真っ直ぐな
   * 最高速シュートが常に最高点になり、両者がそれを撃ち合う安定した周期に入って
   * いた (1400ラリー・425秒で点が動かない局面が実際に発生)。守備側の到達時間を
   * 織り込むと、角度をつけた球やバンクシュートが正しく高く評価される。
   */
  const saveable = pressure.slackSec > SAVEABLE_SLACK_SEC;
  const scoredGoal = reachesGoal !== null && !saveable ? reachesGoal : null;

  let score = 0;

  if (scoredGoal !== null) {
    // 速く決まるほど良い (相手に反応の余地を与えない)
    score += GOAL_REWARD - scoredGoal * 200;
  } else {
    // ゴールに入らなくても、狙った地点へ近づくほど価値がある
    let closest = Number.POSITIVE_INFINITY;
    for (const sample of postPath.samples) {
      const d = sample.pos.dist(candidate.targetPoint);
      if (d < closest) closest = d;
    }
    score += NEAR_MISS_REWARD * Math.max(0, 1 - closest / ctx.config.height);
    // 枠は捉えている = 相手に守備を強制できる。ただし得点としては数えない
    if (reachesGoal !== null) score += FRAMED_SHOT_REWARD;
  }

  if (ownGoal) score -= OWN_GOAL_PENALTY;

  if (scoredGoal === null) {
    const retake = returnToOwnHalf(postPath, ctx);
    if (retake === null) {
      score += KEEP_AWAY_REWARD;
    } else {
      score += KEEP_AWAY_REWARD * Math.min(1, retake.afterSec / 1.2);
      score -= RETURN_SPEED_PENALTY * Math.min(1, retake.speed / ctx.config.maxPuckSpeed);
    }
  }

  // 余裕を飽和させずに評価する。「どうせ届く」球の中でも、より厳しい球を選ぶ
  if (pressure.slackSec > 0) {
    score -= OPPONENT_REACH_PENALTY * Math.min(1.5, pressure.slackSec / 0.6);
  }
  score += OPPONENT_TRAVEL_REWARD * Math.min(1, pressure.travelPx / (ctx.config.height * 0.5));

  score -= solution.contactTime * CONTACT_DELAY_PENALTY;
  if (!solution.feasible) score -= 600 + Math.abs(solution.slackSec) * 1200;

  return { candidate, solution, score, goalInSec: scoredGoal, opponentSlackSec: pressure.slackSec };
}

/** 候補群をまとめて採点し、最良のものを返す */
export function pickBestShot(
  traj: ReturnType<typeof predictPuckPath>,
  candidates: ShotCandidate[],
  ctx: EvaluateContext,
  maxLookaheadSec = 1.5
): ScoredShot | null {
  let best: ScoredShot | null = null;

  for (const candidate of candidates) {
    const scored = evaluateShot(traj, candidate, ctx, maxLookaheadSec);
    if (!scored) continue;
    if (!best || scored.score > best.score) best = scored;
  }

  return best;
}
