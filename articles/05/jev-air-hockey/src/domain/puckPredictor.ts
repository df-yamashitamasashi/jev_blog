/**
 * Puck Trajectory Predictor (Clean Architecture - Domain Layer)
 *
 * PhysicsEngine と同一の運動法則 (空気抵抗・側壁反射・奥壁反射・ゴール開口部) を
 * 前向きに積分して未来の軌道を吐き出す。エージェントの戦術判断とサーボの迎撃解法は
 * どちらもこの予測結果だけを根拠にする。
 *
 * 予測が本物の物理とずれると「読んでいるのに当たらない」という最悪の見え方になるため、
 * 摩擦の適用順序 (減衰 → 積分) と反発係数は engine 側と1行単位で揃えてある。
 */

import { Vec2 } from "./physics";
import { StadiumConfig } from "./gameState";

/** 軌道上の1サンプル */
export interface PuckSample {
  t: number;    // 現在からの経過秒
  pos: Vec2;
  vel: Vec2;
}

/** 軌道予測の結果 */
export interface PuckTrajectory {
  samples: PuckSample[];
  dt: number;
  /** ゴールへ吸い込まれる場合、その時刻と side (失点する側) */
  goalAt: number | null;
  goalConcededBy: "TOP" | "BOTTOM" | null;
  /** 側壁・奥壁で跳ね返る時刻の一覧 (再判断のトリガに使う) */
  bounceTimes: number[];
}

export interface PredictOptions {
  horizonSec?: number;
  dt?: number;
}

const DEFAULT_HORIZON_SEC = 2.2;
const DEFAULT_DT = 1 / 240;

/**
 * バウンド時に接線方向の速度が残る割合。
 * PhysicsEngine 側の壁マテリアル (friction: 0.08) から導かれる 1 - 0.08*0.5 と
 * 一致させる。ここがずれると予測軌道が数十pxずれ、読みが当たらなくなる。
 */
export const WALL_TANGENT_KEEP = 1 - 0.08 * 0.5;

/**
 * パックの未来位置を積分する。
 * スピンによるマグヌス効果は engine 側では微小 (|spin|>0.05 のときだけ働く) なので
 * 予測には含めない。含めると数フレーム先で発散しやすく、かえって精度が落ちる。
 */
export function predictPuckPath(
  startPos: Vec2,
  startVel: Vec2,
  config: StadiumConfig,
  options: PredictOptions = {}
): PuckTrajectory {
  const dt = options.dt ?? DEFAULT_DT;
  const horizon = options.horizonSec ?? DEFAULT_HORIZON_SEC;
  const steps = Math.max(1, Math.round(horizon / dt));

  const decay = Math.pow(config.puckFriction, dt);
  const minX = config.puckRadius;
  const maxX = config.width - config.puckRadius;
  const minY = config.puckRadius;
  const maxY = config.height - config.puckRadius;
  const goalHalf = config.goalWidth * 0.5;
  const centerX = config.width * 0.5;

  const samples: PuckSample[] = [{ t: 0, pos: startPos.clone(), vel: startVel.clone() }];
  const bounceTimes: number[] = [];

  let pos = startPos.clone();
  let vel = startVel.clone();
  let goalAt: number | null = null;
  let goalConcededBy: "TOP" | "BOTTOM" | null = null;

  for (let i = 1; i <= steps; i++) {
    vel = vel.scale(decay);

    const speed = vel.mag();
    if (speed > config.maxPuckSpeed) {
      vel = vel.scale(config.maxPuckSpeed / speed);
    }

    let next = pos.add(vel.scale(dt));
    const t = i * dt;

    // 左右の側壁。法線成分だけ反発係数で跳ね返し、接線成分は壁摩擦ぶんだけ落とす
    // (PhysicsEngine.advanceWithWalls と同じ規則)
    if (next.x < minX) {
      next = new Vec2(minX + (minX - next.x), next.y);
      vel = new Vec2(-vel.x * config.wallRestitution, vel.y * WALL_TANGENT_KEEP);
      bounceTimes.push(t);
    } else if (next.x > maxX) {
      next = new Vec2(maxX - (next.x - maxX), next.y);
      vel = new Vec2(-vel.x * config.wallRestitution, vel.y * WALL_TANGENT_KEEP);
      bounceTimes.push(t);
    }

    // 上下の壁。ゴール開口部の x 範囲には壁が無く、パック中心がゴールラインを
    // 越えた時点で失点になる (PhysicsEngine のゴール判定と同じ基準)。
    const insideGoalMouth = Math.abs(next.x - centerX) <= goalHalf;

    if (insideGoalMouth) {
      if (next.y <= 0) {
        goalAt = t;
        goalConcededBy = "TOP";
        samples.push({ t, pos: next, vel: vel.clone() });
        break;
      }
      if (next.y >= config.height) {
        goalAt = t;
        goalConcededBy = "BOTTOM";
        samples.push({ t, pos: next, vel: vel.clone() });
        break;
      }
    } else if (next.y < minY) {
      next = new Vec2(next.x, minY + (minY - next.y));
      vel = new Vec2(vel.x * WALL_TANGENT_KEEP, -vel.y * config.wallRestitution);
      bounceTimes.push(t);
    } else if (next.y > maxY) {
      next = new Vec2(next.x, maxY - (next.y - maxY));
      vel = new Vec2(vel.x * WALL_TANGENT_KEEP, -vel.y * config.wallRestitution);
      bounceTimes.push(t);
    }

    pos = next;
    samples.push({ t, pos: pos.clone(), vel: vel.clone() });
  }

  return { samples, dt, goalAt, goalConcededBy, bounceTimes };
}

/** 指定時刻のサンプルを線形補間で取り出す */
export function sampleAt(traj: PuckTrajectory, t: number): PuckSample | null {
  if (traj.samples.length === 0) return null;
  if (t <= 0) return traj.samples[0];

  const idx = t / traj.dt;
  const lo = Math.floor(idx);
  if (lo >= traj.samples.length - 1) return traj.samples[traj.samples.length - 1];

  const a = traj.samples[lo];
  const b = traj.samples[lo + 1];
  const f = idx - lo;

  return {
    t,
    pos: a.pos.add(b.pos.sub(a.pos).scale(f)),
    vel: a.vel.add(b.vel.sub(a.vel).scale(f)),
  };
}

/**
 * 指定した Y ラインを最初に横切るサンプル。
 * direction を渡すとその向き (-1: 上へ, +1: 下へ) の通過だけを拾う。
 */
export function firstCrossing(
  traj: PuckTrajectory,
  lineY: number,
  direction: -1 | 1 | 0 = 0
): PuckSample | null {
  for (let i = 1; i < traj.samples.length; i++) {
    const prev = traj.samples[i - 1];
    const cur = traj.samples[i];
    if (prev.pos.y === cur.pos.y) continue;

    const crossed = (prev.pos.y - lineY) * (cur.pos.y - lineY) <= 0;
    if (!crossed) continue;

    const goingDown = cur.pos.y > prev.pos.y;
    if (direction === -1 && goingDown) continue;
    if (direction === 1 && !goingDown) continue;

    const f = (lineY - prev.pos.y) / (cur.pos.y - prev.pos.y);
    return {
      t: prev.t + f * traj.dt,
      pos: prev.pos.add(cur.pos.sub(prev.pos).scale(f)),
      vel: prev.vel.add(cur.vel.sub(prev.vel).scale(f)),
    };
  }
  return null;
}

/**
 * 「このパックは自分のゴールに入る軌道か」の判定。
 * 失点予測がある局面では、得点狙いより先に軌道上へ体を入れる必要がある。
 */
export function threatensGoal(traj: PuckTrajectory, side: "TOP" | "BOTTOM"): number | null {
  return traj.goalConcededBy === side ? traj.goalAt : null;
}

/**
 * マレット (円) がパックへ与える衝撃後のパック速度。
 * physics.resolveCollisionImpulse と同じ式を、予測用に純関数として再掲する。
 * 戦術側が「この狙いで打つと実際どこへ飛ぶか」を検証するために使う。
 */
export function puckVelocityAfterHit(
  puckVel: Vec2,
  malletVel: Vec2,
  normal: Vec2,
  config: StadiumConfig
): Vec2 {
  const relVel = puckVel.sub(malletVel);
  const velAlongNormal = relVel.dot(normal);
  if (velAlongNormal > 0) return puckVel.clone();

  const e = config.malletRestitution;
  const invPuck = 1 / config.puckMass;
  const invMallet = 1 / config.malletMass;

  const j = (-(1 + e) * velAlongNormal) / (invPuck + invMallet);
  let result = puckVel.add(normal.scale(j * invPuck));

  const speed = result.mag();
  if (speed > config.maxPuckSpeed) {
    result = result.scale(config.maxPuckSpeed / speed);
  }
  return result;
}
