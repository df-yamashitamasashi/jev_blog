/**
 * Approach Path Geometry (Clean Architecture - Domain Layer)
 *
 * 構え位置までの移動経路。エージェントは「直線で行くか・曲線で回り込むか」と
 * その速度上限を計画に含めて宣言し、サーボはその経路をなぞるだけ。
 *
 * 曲線は2次ベジェ曲線で表す。制御点は始点と終点の中点から、進行方向に対して
 * 右へ curveOffset * 2 だけずらした位置に置く (曲線の頂点がちょうど curveOffset
 * だけふくらむ)。
 */

import { Vec2 } from "./physics";
import { StadiumConfig } from "./gameState";
import { PuckTrajectory, sampleAt } from "./puckPredictor";
import { MalletLimits, travelTime } from "./interception";

/** 2次ベジェ曲線の制御点。offset は進行方向に対して右が正 (画面座標系) */
export function curveControlPoint(from: Vec2, to: Vec2, offset: number): Vec2 {
  const mid = from.add(to).scale(0.5);
  const dir = to.sub(from);
  const len = dir.mag();
  if (len < 1e-6) return mid;
  // 画面座標系 (y が下向き) で進行方向の右手は (-dy, dx)
  const right = new Vec2(-dir.y / len, dir.x / len);
  return mid.add(right.scale(offset * 2));
}

export function bezierPoint(from: Vec2, control: Vec2, to: Vec2, s: number): Vec2 {
  const u = 1 - s;
  return from.scale(u * u).add(control.scale(2 * u * s)).add(to.scale(s * s));
}

/** 曲線の長さ (折れ線近似) */
export function bezierLength(from: Vec2, control: Vec2, to: Vec2, segments = 16): number {
  let len = 0;
  let prev = from;
  for (let i = 1; i <= segments; i++) {
    const p = bezierPoint(from, control, to, i / segments);
    len += p.dist(prev);
    prev = p;
  }
  return len;
}

export interface ApproachChoice {
  movePath: "STRAIGHT" | "CURVE";
  curveOffset: number;
  moveSpeed: number;
}

/**
 * 構え位置までの移動経路を選ぶ (CPU エージェント用)。
 *
 * 直線で移動するとパックの予測軌道にぶつかるなら、パックと反対側へふくらむ曲線を選ぶ。
 * 移動速度は「間に合う範囲で最も遅い速度」— 余裕があるのに全速で走り込むと、
 * 構え位置で止まり切れずにオーバーランする。
 */
export function chooseApproach(
  from: Vec2,
  fromVel: Vec2,
  to: Vec2,
  arriveBySec: number,
  traj: PuckTrajectory,
  limits: MalletLimits,
  config: StadiumConfig
): ApproachChoice {
  const clearance = config.puckRadius + config.malletRadius + 8;
  const straightHit = pathHitsPuck(from, null, to, arriveBySec, traj, clearance);

  let movePath: "STRAIGHT" | "CURVE" = "STRAIGHT";
  let curveOffset = 0;
  let control: Vec2 | null = null;

  if (straightHit) {
    // パックが直線のどちら側にあるかを見て、反対側へふくらませる
    const dir = to.sub(from);
    const len = dir.mag();
    if (len > 1e-6) {
      const right = new Vec2(-dir.y / len, dir.x / len);
      const side = straightHit.sub(from).dot(right) >= 0 ? -1 : 1;
      for (const magnitude of [clearance, clearance * 1.6, clearance * 2.4]) {
        const offset = side * magnitude;
        const c = curveControlPoint(from, to, offset);
        if (!pathHitsPuck(from, c, to, arriveBySec, traj, clearance)) {
          movePath = "CURVE";
          curveOffset = offset;
          control = c;
          break;
        }
      }
    }
  }

  const distance = control ? bezierLength(from, control, to) : from.dist(to);

  // 判断の瞬間に別の向きへ走っていたなら、その勢いを殺して向き直る時間が先に要る
  const heading = to.sub(from);
  const along = heading.mag() > 1e-6 ? fromVel.dot(heading.normalize()) : 0;
  const turnSec = fromVel.sub(heading.mag() > 1e-6 ? heading.normalize().scale(along) : new Vec2(0, 0)).mag() / limits.maxAccel;
  const budget = arriveBySec * 0.6 - turnSec - Math.max(0, -along) / limits.maxAccel;

  let moveSpeed = limits.maxSpeed;
  for (let v = 350; v < limits.maxSpeed && budget > 0; v += 50) {
    if (travelTime(distance, 0, v, limits.maxAccel) <= budget) {
      moveSpeed = v;
      break;
    }
  }

  return { movePath, curveOffset, moveSpeed };
}

/**
 * 経路を等速でたどったとき、どこかでパックとぶつかるか。ぶつかるならその時のパック位置。
 * 厳密な運動学は不要 — 経路選びの判断材料として「当たりそうか」が分かればよい。
 */
function pathHitsPuck(
  from: Vec2,
  control: Vec2 | null,
  to: Vec2,
  arriveBySec: number,
  traj: PuckTrajectory,
  clearance: number
): Vec2 | null {
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    const s = i / steps;
    const p = control ? bezierPoint(from, control, to, s) : from.add(to.sub(from).scale(s));
    const puck = sampleAt(traj, arriveBySec * s);
    if (puck && puck.pos.dist(p) < clearance) return puck.pos;
  }
  return null;
}
