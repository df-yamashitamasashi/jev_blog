/**
 * Interception Solver (Clean Architecture - Domain Layer)
 *
 * 「いつ・どこにマレット中心を置き、どちらへ振り抜けば、パックが狙った座標へ飛ぶか」
 * を厳密に解く。
 *
 * 核心となる物理: パックの出射方向を決めるのは **スイング方向ではなく接触法線**
 * (マレット中心 → パック中心のベクトル) である。したがって狙いを実現する手段は
 * 「振り抜く向きを変えること」ではなく「パックの反対側の正しい位置へ回り込むこと」。
 * 旧実装は迎撃点を軌道の交点に置いてスイング方向だけで狙おうとしていたため、
 * 宣言した狙いと実際の飛翔方向が構造的に一致しなかった。
 */

import { Vec2 } from "./physics";
import { StadiumConfig } from "./gameState";
import { PuckTrajectory, puckVelocityAfterHit } from "./puckPredictor";
import { PlaySide } from "./shotPlanValidator";

/** マレットの運動制約 */
export interface MalletLimits {
  maxSpeed: number;
  maxAccel: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface InterceptSolution {
  /** 接触の瞬間にマレット中心を置くべき座標 */
  contactPoint: Vec2;
  /** 現在から接触までの秒数 */
  contactTime: number;
  /** その瞬間のパック位置 */
  puckPosAtContact: Vec2;
  /** その瞬間のパック速度 */
  puckVelAtContact: Vec2;
  /** 振り抜く単位ベクトル (= 接触法線)。この向きにパックが飛ぶ */
  swingDir: Vec2;
  /** 間に合うまでの余裕 (秒)。負なら間に合わない */
  slackSec: number;
  /** 余裕をもって到達できるか */
  feasible: boolean;
  /** 実際に飛ぶと予測されるパック速度 */
  predictedPuckVel: Vec2;
  /** 狙い座標との方向誤差 (度)。収束しきらなかった場合に大きくなる */
  aimErrorDeg: number;
  /** この解を実行するときの振り抜き速度 */
  swingSpeed: number;
}

export function limitsFor(side: PlaySide, config: StadiumConfig): MalletLimits {
  const margin = config.malletRadius;
  return {
    maxSpeed: config.maxMalletSpeed,
    maxAccel: config.maxMalletAccel,
    minX: margin,
    maxX: config.width - margin,
    minY: side === "TOP" ? margin : config.height * 0.52,
    maxY: side === "TOP" ? config.height * 0.48 : config.height - margin,
  };
}

/**
 * 加速度制限のもとで距離 dist を「止まらずに」走り抜ける最短時間。
 * v0 は目標方向への現在速度成分 (離れる向きなら負)。
 */
export function travelTime(dist: number, v0: number, maxSpeed: number, maxAccel: number): number {
  if (dist <= 0) return 0;

  // 最高速へ達するまでに稼げる距離
  const tToTop = Math.max(0, (maxSpeed - v0) / maxAccel);
  const distToTop = v0 * tToTop + 0.5 * maxAccel * tToTop * tToTop;

  if (dist <= distToTop) {
    // 加速途中で到達: 0.5*a*t^2 + v0*t - dist = 0
    const disc = v0 * v0 + 2 * maxAccel * dist;
    return (-v0 + Math.sqrt(Math.max(0, disc))) / maxAccel;
  }

  return tToTop + (dist - distToTop) / maxSpeed;
}

function clampPoint(p: Vec2, limits: MalletLimits): Vec2 {
  return new Vec2(
    Math.max(limits.minX, Math.min(limits.maxX, p.x)),
    Math.max(limits.minY, Math.min(limits.maxY, p.y))
  );
}

function rotate(v: Vec2, rad: number): Vec2 {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return new Vec2(v.x * c - v.y * s, v.x * s + v.y * c);
}

/** a から b への符号付き角度差 (rad, -π..π) */
function signedAngle(from: Vec2, to: Vec2): number {
  return Math.atan2(from.cross(to), from.dot(to));
}

/**
 * 狙い方向 desiredDir へパックを飛ばすための接触法線を求める。
 *
 * 出射速度は `入射速度 + 法線方向インパルス` なので、飛んでくるパックの運動量が
 * 残るぶん、単純に「狙いの方向へ法線を向ける」だけでは横にずれる。法線を少しずつ
 * 回して出射方向が狙いに一致する不動点を求める (数回で収束する)。
 */
export function solveContactNormal(
  puckVel: Vec2,
  desiredDir: Vec2,
  swingSpeed: number,
  config: StadiumConfig,
  iterations = 8
): { normal: Vec2; predictedVel: Vec2; errorDeg: number } {
  let normal = desiredDir.normalize();
  let predictedVel = puckVel.clone();
  let errorRad = Math.PI;

  for (let i = 0; i < iterations; i++) {
    const malletVel = normal.scale(swingSpeed);
    predictedVel = puckVelocityAfterHit(puckVel, malletVel, normal, config);

    if (predictedVel.magSq() < 1e-6) break;

    errorRad = signedAngle(predictedVel.normalize(), desiredDir);
    if (Math.abs(errorRad) < 0.0005) break;

    // 法線を誤差ぶん回す。過補正で振動しないよう少し緩める
    normal = rotate(normal, errorRad * 0.85).normalize();
  }

  return {
    normal,
    predictedVel,
    errorDeg: Math.abs((errorRad * 180) / Math.PI),
  };
}

export interface SolveOptions {
  /** 振り抜き速度 (px/s) */
  swingSpeed: number;
  /** 実行可能と認める最小の余裕 (秒) */
  minSlackSec?: number;
  /**
   * 振りかぶりに使いたい時間 (秒)。
   *
   * 「ぎりぎり届く」打点を選ぶと、到達と同時にパックが来て振りかぶれず、
   * 止まったマレットで弾くだけの弱い当たりになる。かといってこれを実行可能性の
   * 必須条件にすると、少し速い球はすべて迎撃不能と判定されて守りに回ってしまう
   * (計測では平均打球速度が 1577 → 917 px/s まで落ちた)。
   * そこで必須条件にはせず、足りないぶんをコストとして評価する。
   */
  setupSec?: number;
  /** 予測を切り出す最大時間 */
  maxLookaheadSec?: number;
  /** 接触点のサンプリング間隔 (秒)。細かすぎても解は変わらない */
  sampleStepSec?: number;
  /**
   * エージェントが「ここで迎え撃ちたい」と宣言した座標。
   * 実行可能な解が複数あるとき、この宣言に近い打点を優先する。
   * 早い打点 (相手に時間を与えない) と深い打点 (読み違えても取り返せる) の
   * どちらを選ぶかは戦術であり、サーボではなくエージェントの裁量に委ねる。
   */
  preferPoint?: Vec2;
  /** 法線を求める反復回数。走査中は粗く、採用した解だけ精密に解き直す */
  iterations?: number;
}

/** 最初の実行可能解からこの秒数ぶんだけ候補を探し続ける */
const CANDIDATE_WINDOW_SEC = 0.45;

/** 宣言した迎撃点からのズレ 1px を、何秒ぶんの遅れと等価に扱うか */
const PREFERENCE_WEIGHT_SEC_PER_PX = 1 / 3200;

/** 助走時間の不足 1秒を、何秒ぶんの遅れと等価に扱うか */
const SETUP_DEFICIT_WEIGHT = 1.6;

/**
 * 軌道上から「狙い通りに打てる最も早い接触」を探す。
 *
 * 間に合う解が1つも無い場合は null ではなく「最も惜しい解」(slackSec < 0) を返す。
 * 呼び出し側はそれでも全力で向かう — 手が届かないからといって立ち止まるのが、
 * 旧実装が棒立ちに見えた最大の原因だった。
 */
export function solveIntercept(
  traj: PuckTrajectory,
  malletPos: Vec2,
  malletVel: Vec2,
  aimPoint: Vec2,
  limits: MalletLimits,
  config: StadiumConfig,
  options: SolveOptions
): InterceptSolution | null {
  const minSlack = options.minSlackSec ?? 0.05;
  const maxLook = options.maxLookaheadSec ?? Number.POSITIVE_INFINITY;
  const stride = Math.max(1, Math.round((options.sampleStepSec ?? 1 / 120) / traj.dt));
  const contactDist = config.puckRadius + config.malletRadius;

  const iterations = options.iterations ?? 4;

  // 実行可能解が無いまま走査し終えたときのために、最も惜しい解を覚えておく
  let fallback: InterceptSolution | null = null;
  let best: InterceptSolution | null = null;
  let bestCost = Number.POSITIVE_INFINITY;
  let firstFeasibleAt = Number.POSITIVE_INFINITY;

  for (let i = 0; i < traj.samples.length; i += stride) {
    const sample = traj.samples[i];
    if (sample.t > maxLook) break;
    // 最初の実行可能解より十分あとの打点は、もう戦術的な選択肢ではない
    if (sample.t > firstFeasibleAt + CANDIDATE_WINDOW_SEC) break;

    const desired = aimPoint.sub(sample.pos);
    if (desired.magSq() < 1e-6) continue;

    const { normal, predictedVel, errorDeg } = solveContactNormal(
      sample.vel,
      desired,
      options.swingSpeed,
      config,
      iterations
    );

    const idealContact = sample.pos.sub(normal.scale(contactDist));
    const contact = clampPoint(idealContact, limits);

    // 自陣の外へはみ出す接触点は、いくら早くても実行できない
    if (contact.dist(idealContact) > 1.0) continue;

    const toContact = contact.sub(malletPos);
    const dist = toContact.mag();
    const v0 = dist > 1e-6 ? malletVel.dot(toContact.scale(1 / dist)) : 0;
    const need = travelTime(dist, v0, limits.maxSpeed, limits.maxAccel);
    const slack = sample.t - need;

    const solution: InterceptSolution = {
      contactPoint: contact,
      contactTime: sample.t,
      puckPosAtContact: sample.pos.clone(),
      puckVelAtContact: sample.vel.clone(),
      swingDir: normal,
      slackSec: slack,
      feasible: slack >= minSlack,
      predictedPuckVel: predictedVel,
      aimErrorDeg: errorDeg,
      swingSpeed: options.swingSpeed,
    };

    if (!solution.feasible) {
      if (!fallback || slack > fallback.slackSec) fallback = solution;
      continue;
    }

    if (sample.t < firstFeasibleAt) firstFeasibleAt = sample.t;

    // 早い打点ほど良い。ただし宣言された迎撃点の近さと、振りかぶる余裕は
    // その差を埋める価値がある
    const preference = options.preferPoint
      ? contact.dist(options.preferPoint) * PREFERENCE_WEIGHT_SEC_PER_PX
      : 0;
    const setupDeficit = Math.max(0, (options.setupSec ?? 0) - slack);
    const cost = sample.t + preference + setupDeficit * SETUP_DEFICIT_WEIGHT;

    if (cost < bestCost) {
      bestCost = cost;
      best = solution;
    }
  }

  if (!best) return fallback;

  // 走査は粗い反復で回しているので、採用した打点だけ法線を精密に解き直す。
  // 接触点が数px変わるだけで狙いは数度ずれる
  const refined = solveContactNormal(
    best.puckVelAtContact,
    aimPoint.sub(best.puckPosAtContact),
    options.swingSpeed,
    config,
    12
  );
  const idealContact = best.puckPosAtContact.sub(refined.normal.scale(contactDist));
  const contact = clampPoint(idealContact, limits);

  if (contact.dist(idealContact) <= 1.0) {
    best.contactPoint = contact;
    best.swingDir = refined.normal;
    best.predictedPuckVel = refined.predictedVel;
    best.aimErrorDeg = refined.errorDeg;
  }

  return best;
}

/**
 * 守りの立ち位置。
 *
 * 迎撃が間に合わない局面では、自陣ゴールと「脅威の到達点」を結ぶ線上に体を入れる。
 * 決め打ちのホームポジションで待つのではなく、実際に飛んでくる先を塞ぐ。
 */
export function solveBlockPoint(
  traj: PuckTrajectory,
  side: PlaySide,
  limits: MalletLimits,
  config: StadiumConfig
): Vec2 {
  const goalY = side === "TOP" ? 0 : config.height;
  const goalCenter = new Vec2(config.width * 0.5, goalY);
  const guardY = side === "TOP" ? limits.minY + config.malletRadius * 1.2 : limits.maxY - config.malletRadius * 1.2;

  // 自陣ゴールラインに最も近づく予測点を脅威とみなす
  let threat: Vec2 | null = null;
  let bestDepth = Number.POSITIVE_INFINITY;

  for (const sample of traj.samples) {
    const depth = side === "TOP" ? sample.pos.y : config.height - sample.pos.y;
    if (depth < bestDepth) {
      bestDepth = depth;
      threat = sample.pos;
    }
  }

  if (!threat) return clampPoint(new Vec2(goalCenter.x, guardY), limits);

  // 脅威点とゴール中心の間に立つ。ゴールへ寄りすぎると弾いた球がそのまま入るため
  // 守備ラインより前には出ない
  const toGoal = goalCenter.sub(threat);
  const lead = toGoal.mag() > 1e-6 ? toGoal.normalize() : new Vec2(0, side === "TOP" ? -1 : 1);
  const stand = threat.add(lead.scale(config.malletRadius * 0.8));

  // x はゴール枠内に収める (枠外を守っても意味がない)
  const postMargin = config.goalWidth * 0.5 + config.malletRadius;
  const clampedX = Math.max(
    config.width * 0.5 - postMargin,
    Math.min(config.width * 0.5 + postMargin, stand.x)
  );

  return clampPoint(new Vec2(clampedX, stand.y), limits);
}
