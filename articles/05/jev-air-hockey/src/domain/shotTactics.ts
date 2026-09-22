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
  const offsets = [-(half - inset), -(half - inset) * 0.5, 0, (half - inset) * 0.5, half - inset];

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

/** 打った後の軌道を実際に積分して、相手が触れるまでの余裕を測る */
function opponentInterceptSlack(
  postPath: ReturnType<typeof predictPuckPath>,
  ctx: EvaluateContext,
  untilSec: number
): number {
  const contactDist = ctx.config.puckRadius + ctx.config.malletRadius;
  let worst = Number.NEGATIVE_INFINITY;

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
    if (slack > worst) worst = slack;
  }

  return worst === Number.NEGATIVE_INFINITY ? -1 : worst;
}

const GOAL_REWARD = 1200;
const OWN_GOAL_PENALTY = 4000;
const OPPONENT_REACH_PENALTY = 900;
const CONTACT_DELAY_PENALTY = 260;
const NEAR_MISS_REWARD = 380;

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
    }
  );

  if (!solution) return null;

  // 打った直後のパックを、実際の物理で飛ばしてみる
  const postPath = predictPuckPath(solution.puckPosAtContact, solution.predictedPuckVel, ctx.config, {
    horizonSec: 1.8,
    dt: 1 / 120,
  });

  const opponentSide: PlaySide = ctx.side === "TOP" ? "BOTTOM" : "TOP";
  const scoredGoal = postPath.goalConcededBy === opponentSide ? postPath.goalAt : null;
  const ownGoal = postPath.goalConcededBy === ctx.side;

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
  }

  if (ownGoal) score -= OWN_GOAL_PENALTY;

  const until = scoredGoal ?? 1.8;
  const opponentSlack = opponentInterceptSlack(postPath, ctx, until);
  if (opponentSlack > 0) {
    score -= OPPONENT_REACH_PENALTY * Math.min(1, opponentSlack / 0.3);
  }

  score -= solution.contactTime * CONTACT_DELAY_PENALTY;
  if (!solution.feasible) score -= 600 + Math.abs(solution.slackSec) * 1200;

  return { candidate, solution, score, goalInSec: scoredGoal, opponentSlackSec: opponentSlack };
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
