/**
 * High-Precision 2D Physics Engine Core (Clean Architecture - Domain Layer)
 * 連続衝突判定 (Continuous Collision Detection: CCD) とサブステップ力学計算
 */

export interface Vector2 {
  x: number;
  y: number;
}

export class Vec2 implements Vector2 {
  constructor(public x: number = 0, public y: number = 0) {}

  static from(v: Vector2): Vec2 {
    return new Vec2(v.x, v.y);
  }

  clone(): Vec2 {
    return new Vec2(this.x, this.y);
  }

  set(x: number, y: number): this {
    this.x = x;
    this.y = y;
    return this;
  }

  add(v: Vector2): Vec2 {
    return new Vec2(this.x + v.x, this.y + v.y);
  }

  sub(v: Vector2): Vec2 {
    return new Vec2(this.x - v.x, this.y - v.y);
  }

  scale(s: number): Vec2 {
    return new Vec2(this.x * s, this.y * s);
  }

  dot(v: Vector2): number {
    return this.x * v.x + this.y * v.y;
  }

  cross(v: Vector2): number {
    return this.x * v.y - this.y * v.x;
  }

  magSq(): number {
    return this.x * this.x + this.y * this.y;
  }

  mag(): number {
    return Math.sqrt(this.magSq());
  }

  normalize(): Vec2 {
    const m = this.mag();
    if (m === 0) return new Vec2(0, 0);
    return new Vec2(this.x / m, this.y / m);
  }

  dist(v: Vector2): number {
    return Math.hypot(this.x - v.x, this.y - v.y);
  }

  distSq(v: Vector2): number {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    return dx * dx + dy * dy;
  }

  reflect(normal: Vec2): Vec2 {
    // v - 2 * (v . n) * n
    const d = this.dot(normal);
    return this.sub(normal.scale(2 * d));
  }
}

/** 物理マテリアル定数 */
export interface PhysicsMaterial {
  restitution: number;   // 反発係数 (0.0: 完全非弾性, 1.0: 完全弾性)
  friction: number;      // 接触摩擦係数
  airResistance: number; // 空気摩擦 (毎秒減衰率)
}

/** 円形物理ボディ (パック, マレット) */
export interface CircleBody {
  id: string;
  pos: Vec2;
  vel: Vec2;
  radius: number;
  mass: number;          // 質量 (kg相当)
  material: PhysicsMaterial;
  spin: number;          // 角速度 (rad/s)
}

/** 線分壁 (コートの境界・ゴールポスト) */
export interface WallSegment {
  p1: Vec2;
  p2: Vec2;
  normal: Vec2;          // コート内側を向く法線
  material: PhysicsMaterial;
  isGoalZone?: boolean;  // ゴール開口部かどうか
}

/** 衝突接触点 (Manifold) */
export interface ContactManifold {
  timeOfImpact: number;  // 0.0 ~ 1.0 (サブステップ内衝突タイム)
  point: Vec2;           // 接触位置
  normal: Vec2;          // 衝突法線 (Body2からBody1へ向かう)
  penetration: number;   // 重なり深度
}

/**
 * 連続衝突判定 (Continuous Collision Detection: Sweep Test)
 * 移動する円と移動する円の衝突瞬間 t ∈ [0, 1] を2次方程式で厳密に解く
 */
export function sweepCircleVsCircle(
  posA: Vec2,
  velA: Vec2,
  radiusA: number,
  posB: Vec2,
  velB: Vec2,
  radiusB: number,
  dt: number
): ContactManifold | null {
  // 相対系: Bを静止させ、Aが vRel = (velA - velB) * dt で移動するとみなす
  const dPos = posA.sub(posB);
  const dVel = velA.sub(velB).scale(dt);
  const targetRadius = radiusA + radiusB;

  // 既に重なっている場合 (t = 0)
  const initialDistSq = dPos.magSq();
  if (initialDistSq < targetRadius * targetRadius) {
    const dist = Math.sqrt(initialDistSq) || 0.0001;
    const normal = dPos.scale(1 / dist);
    return {
      timeOfImpact: 0,
      point: posB.add(normal.scale(radiusB)),
      normal,
      penetration: targetRadius - dist,
    };
  }

  // |dPos + t * dVel|^2 = targetRadius^2
  // a * t^2 + 2b * t + c = 0
  const a = dVel.magSq();
  if (a < 1e-8) return null; // 相対移動なし

  const b = dPos.dot(dVel);
  if (b >= 0) return null; // 離れる方向に移動している

  const c = dPos.magSq() - targetRadius * targetRadius;
  const discriminant = b * b - a * c;

  if (discriminant < 0) return null; // 衝突なし

  const t = (-b - Math.sqrt(discriminant)) / a;
  if (t < 0 || t > 1.0) return null; // この時間枠内では衝突しない

  // 衝突時の位置
  const hitPosA = posA.add(velA.scale(t * dt));
  const hitPosB = posB.add(velB.scale(t * dt));
  const hitNormal = hitPosA.sub(hitPosB).normalize();

  return {
    timeOfImpact: t,
    point: hitPosB.add(hitNormal.scale(radiusB)),
    normal: hitNormal,
    penetration: 0,
  };
}

/**
 * 移動する円と静止した線分(壁)の連続衝突判定
 */
export function sweepCircleVsSegment(
  pos: Vec2,
  vel: Vec2,
  radius: number,
  seg: WallSegment,
  dt: number
): ContactManifold | null {
  const move = vel.scale(dt);
  const segVec = seg.p2.sub(seg.p1);
  const segLenSq = segVec.magSq();
  if (segLenSq < 1e-6) return null;

  // 線分の法線方向におけるパックの距離
  // d(t) = (pos + t * move - p1) . normal
  const d0 = pos.sub(seg.p1).dot(seg.normal);
  const d1 = pos.add(move).sub(seg.p1).dot(seg.normal);

  // パックが法線の裏側から侵入または法線方向に遠ざかる場合は除外
  const vNorm = d1 - d0;
  if (Math.abs(vNorm) < 1e-8) {
    if (d0 < radius && d0 > -radius) {
      // 既に壁に接触している
      return {
        timeOfImpact: 0,
        point: pos.sub(seg.normal.scale(radius)),
        normal: seg.normal,
        penetration: radius - d0,
      };
    }
    return null;
  }

  // 法線方向に距離 radius になる時刻 t
  const t = (radius - d0) / vNorm;
  if (t < 0 || t > 1.0) return null;

  // その時刻における円中心の座標
  const contactCenter = pos.add(move.scale(t));
  // 線分上の投影位置 projection on segment
  const proj = contactCenter.sub(seg.p1).dot(segVec) / segLenSq;

  // 線分の内側で接触するか
  if (proj >= 0 && proj <= 1.0) {
    return {
      timeOfImpact: t,
      point: contactCenter.sub(seg.normal.scale(radius)),
      normal: seg.normal,
      penetration: 0,
    };
  }

  // 線分の両端点(p1, p2)との円角衝突判定 (丸みのあるコーナー衝突)
  const hitP1 = sweepCircleVsPoint(pos, vel, radius, seg.p1, dt);
  if (hitP1) return hitP1;

  const hitP2 = sweepCircleVsPoint(pos, vel, radius, seg.p2, dt);
  if (hitP2) return hitP2;

  return null;
}

/** 円と点(頂点/角)の衝突判定 */
function sweepCircleVsPoint(
  pos: Vec2,
  vel: Vec2,
  radius: number,
  corner: Vec2,
  dt: number
): ContactManifold | null {
  const dPos = pos.sub(corner);
  const move = vel.scale(dt);
  const a = move.magSq();
  if (a < 1e-8) return null;

  const b = dPos.dot(move);
  if (b >= 0) return null;

  const c = dPos.magSq() - radius * radius;
  const disc = b * b - a * c;
  if (disc < 0) return null;

  const t = (-b - Math.sqrt(disc)) / a;
  if (t < 0 || t > 1.0) return null;

  const hitPos = pos.add(move.scale(t));
  const normal = hitPos.sub(corner).normalize();

  return {
    timeOfImpact: t,
    point: corner,
    normal,
    penetration: 0,
  };
}

/**
 * 2物体間の衝突インパルス解法 (2D Rigid Body Impulse with Restitution & Friction)
 */
export function resolveCollisionImpulse(
  bodyA: CircleBody,
  bodyB: CircleBody,
  manifold: ContactManifold
): void {
  const normal = manifold.normal;
  const relVel = bodyA.vel.sub(bodyB.vel);

  // 法線方向の相対速度
  const velAlongNormal = relVel.dot(normal);
  // 物体同士が既に離れる方向に動いているなら何もしない
  if (velAlongNormal > 0) return;

  // 実効反発係数 (マレットによるスマッシュ時は勢いを増幅)
  const e = Math.max(bodyA.material.restitution, bodyB.material.restitution);

  // 質量インバース
  const invMassA = 1 / bodyA.mass;
  const invMassB = 1 / bodyB.mass;

  // 法線方向の反発インパルススカラー J
  let j = -(1 + e) * velAlongNormal / (invMassA + invMassB);

  // インパルス適用
  const impulse = normal.scale(j);
  bodyA.vel = bodyA.vel.add(impulse.scale(invMassA));
  bodyB.vel = bodyB.vel.sub(impulse.scale(invMassB));

  // 接線方向 (摩擦 & スピン転嫁)
  const tangent = new Vec2(-normal.y, normal.x);
  const velAlongTangent = relVel.dot(tangent);

  const frictionMu = Math.sqrt(bodyA.material.friction * bodyB.material.friction);
  let jt = -velAlongTangent / (invMassA + invMassB);

  // クーロン摩擦の範囲制限 (|jt| <= mu * j)
  const maxJt = frictionMu * j;
  jt = Math.max(-maxJt, Math.min(maxJt, jt));

  const tangentImpulse = tangent.scale(jt);
  bodyA.vel = bodyA.vel.add(tangentImpulse.scale(invMassA));
  bodyB.vel = bodyB.vel.sub(tangentImpulse.scale(invMassB));

  // スピン角運動量の変化
  bodyA.spin += (jt / bodyA.mass) * 0.05;
  bodyB.spin -= (jt / bodyB.mass) * 0.05;
}
