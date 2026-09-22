/**
 * High-Precision Physics Engine UseCase (Clean Architecture - UseCases Layer)
 * 8-Substep CCD (Continuous Collision Detection) & Rigid Body Impulse Dynamics
 */

import {
  Vec2,
  CircleBody,
  WallSegment,
  sweepCircleVsCircle,
  sweepCircleVsSegment,
  resolveCollisionImpulse,
  ContactManifold,
} from "../domain/physics";
import { StadiumConfig } from "../domain/gameState";

export interface CollisionEvent {
  type: "PUCK_WALL" | "PUCK_MALLET_PLAYER" | "PUCK_MALLET_JEV" | "GOAL_PLAYER" | "GOAL_JEV";
  pos: Vec2;
  impactSpeed: number;
}

export class PhysicsEngine {
  private puck: CircleBody;
  private playerMallet: CircleBody;
  private jevMallet: CircleBody;
  private walls: WallSegment[] = [];
  private readonly config: StadiumConfig;
  private readonly subSteps: number = 10; // 1フレームを10分割して高精度計算

  constructor(config: StadiumConfig) {
    this.config = config;

    // パック初期化
    this.puck = {
      id: "puck",
      pos: new Vec2(config.width * 0.5, config.height * 0.5),
      vel: new Vec2(0, 0),
      radius: config.puckRadius,
      mass: config.puckMass,
      spin: 0,
      material: {
        // resolveCollisionImpulse は両者の max を採るため、パック・マレット双方に
        // 同じ接触ペア値を入れておく。壁との反発は wall.material 側で別途扱われる。
        restitution: config.malletRestitution,
        friction: 0.05,
        airResistance: config.puckFriction,
      },
    };

    // プレイヤーマレット初期化 (下側)
    this.playerMallet = {
      id: "mallet_player",
      pos: new Vec2(config.width * 0.5, config.height * 0.8),
      vel: new Vec2(0, 0),
      radius: config.malletRadius,
      mass: config.malletMass,
      spin: 0,
      material: {
        restitution: config.malletRestitution,
        friction: 0.2,
        airResistance: 1.0,
      },
    };

    // Jevマレット初期化 (上側)
    this.jevMallet = {
      id: "mallet_jev",
      pos: new Vec2(config.width * 0.5, config.height * 0.2),
      vel: new Vec2(0, 0),
      radius: config.malletRadius,
      mass: config.malletMass,
      spin: 0,
      material: {
        restitution: config.malletRestitution,
        friction: 0.2,
        airResistance: 1.0,
      },
    };

    this.initCourtWalls();
  }

  private initCourtWalls(): void {
    const { width, height, goalWidth, wallRestitution } = this.config;
    const goalLeft = (width - goalWidth) * 0.5;
    const goalRight = (width + goalWidth) * 0.5;
    const mat = { restitution: wallRestitution, friction: 0.08, airResistance: 1.0 };

    this.walls = [
      // 左側壁 (上から下)
      { p1: new Vec2(0, 0), p2: new Vec2(0, height), normal: new Vec2(1, 0), material: mat },
      // 右側壁 (上から下)
      { p1: new Vec2(width, 0), p2: new Vec2(width, height), normal: new Vec2(-1, 0), material: mat },

      // 上壁 (Jev陣地側・ゴールポスト左)
      { p1: new Vec2(0, 0), p2: new Vec2(goalLeft, 0), normal: new Vec2(0, 1), material: mat },
      // 上壁 (Jev陣地側・ゴールポスト右)
      { p1: new Vec2(goalRight, 0), p2: new Vec2(width, 0), normal: new Vec2(0, 1), material: mat },
      // 上ゴールポケット (奥行きガイド壁 & 奥ネット)
      { p1: new Vec2(goalLeft, 0), p2: new Vec2(goalLeft, -60), normal: new Vec2(1, 0), material: mat },
      { p1: new Vec2(goalRight, 0), p2: new Vec2(goalRight, -60), normal: new Vec2(-1, 0), material: mat },
      { p1: new Vec2(goalLeft, -60), p2: new Vec2(goalRight, -60), normal: new Vec2(0, 1), material: mat },

      // 下壁 (Player陣地側・ゴールポスト左)
      { p1: new Vec2(0, height), p2: new Vec2(goalLeft, height), normal: new Vec2(0, -1), material: mat },
      // 下壁 (Player陣地側・ゴールポスト右)
      { p1: new Vec2(goalRight, height), p2: new Vec2(width, height), normal: new Vec2(0, -1), material: mat },
      // 下ゴールポケット (奥行きガイド壁 & 奥ネット)
      { p1: new Vec2(goalLeft, height), p2: new Vec2(goalLeft, height + 60), normal: new Vec2(1, 0), material: mat },
      { p1: new Vec2(goalRight, height), p2: new Vec2(goalRight, height + 60), normal: new Vec2(-1, 0), material: mat },
      { p1: new Vec2(goalLeft, height + 60), p2: new Vec2(goalRight, height + 60), normal: new Vec2(0, -1), material: mat },
    ];
  }

  getPuck(): CircleBody {
    return this.puck;
  }

  getPlayerMallet(): CircleBody {
    return this.playerMallet;
  }

  getJevMallet(): CircleBody {
    return this.jevMallet;
  }

  getWalls(): WallSegment[] {
    return this.walls;
  }

  /**
   * 1フレームの物理シミュレーション (サブステップ積分 & 連続衝突判定)
   */
  step(dt: number, onCollision?: (event: CollisionEvent) => void): "GOAL_PLAYER" | "GOAL_JEV" | null {
    // タイムステップの安全性制限
    const clampedDt = Math.min(dt, 0.033);
    const subDt = clampedDt / this.subSteps;

    const goalLeft = (this.config.width - this.config.goalWidth) * 0.5;
    const goalRight = (this.config.width + this.config.goalWidth) * 0.5;

    // airResistance は「1秒あたりの速度保持率」。dt に依存させないと、
    // step() の呼び出し頻度が変わるたびに実効的な減衰速度が変わってしまう
    // (例: 60Hzから120Hzに呼び出し頻度を倍にすると、減衰が体感で倍近く強くなる)。
    const subFriction = Math.pow(this.puck.material.airResistance, subDt);

    for (let stepIdx = 0; stepIdx < this.subSteps; stepIdx++) {
      // 1. パックの速度に摩擦とスピン効果を適用
      this.puck.vel = this.puck.vel.scale(subFriction);

      // マグヌス風スピンによる微小横加速度
      if (Math.abs(this.puck.spin) > 0.05) {
        const perp = new Vec2(-this.puck.vel.y, this.puck.vel.x).normalize();
        this.puck.vel = this.puck.vel.add(perp.scale(this.puck.spin * 1.5 * subDt));
        this.puck.spin *= 0.995;
      }

      // 速度制限 (貫通・極端な速度発散防止)
      const currentSpeed = this.puck.vel.mag();
      if (currentSpeed > this.config.maxPuckSpeed) {
        this.puck.vel = this.puck.vel.scale(this.config.maxPuckSpeed / currentSpeed);
      }

      // 2. マレットとの連続衝突判定 (CCD)
      this.checkMalletCollision(this.playerMallet, "PUCK_MALLET_PLAYER", subDt, onCollision);
      this.checkMalletCollision(this.jevMallet, "PUCK_MALLET_JEV", subDt, onCollision);

      // 3. ゴールライン通過判定 (壁衝突より先に判定してゴール開口部の壁誤衝突を完全防止)
      //
      // 判定範囲はゴール開口部そのもの。旧実装は ±10〜±20px の余裕を持たせて
      // いたため、ポストの外側を通ったパックが得点になることがあった
      // (実測で x=423 / 開口部は 190〜410 の失点を確認)。守る側の予測は開口部を
      // 基準にしているので、ここが広いと「守れない失点」になる。
      const nextY = this.puck.pos.y + this.puck.vel.y * subDt;
      const inMouth = this.puck.pos.x >= goalLeft && this.puck.pos.x <= goalRight;

      // Jevゴール (上部 y=0 ライン交差)
      if (
        (this.puck.vel.y < 0 && this.puck.pos.y >= 0 && nextY <= 0 && inMouth) ||
        (this.puck.pos.y < 0 && inMouth) ||
        this.puck.pos.y < -30
      ) {
        this.puck.vel.set(0, 0);
        if (onCollision) {
          onCollision({ type: "GOAL_PLAYER", pos: this.puck.pos.clone(), impactSpeed: currentSpeed });
        }
        return "GOAL_PLAYER";
      }

      // Playerゴール (下部 y=height ライン交差)
      if (
        (this.puck.vel.y > 0 && this.puck.pos.y <= this.config.height && nextY >= this.config.height && inMouth) ||
        (this.puck.pos.y > this.config.height && inMouth) ||
        this.puck.pos.y > this.config.height + 30
      ) {
        this.puck.vel.set(0, 0);
        if (onCollision) {
          onCollision({ type: "GOAL_JEV", pos: this.puck.pos.clone(), impactSpeed: currentSpeed });
        }
        return "GOAL_JEV";
      }

      // 4. 壁との連続衝突判定 + 位置の積分 (衝突時刻順に解く)
      this.advanceWithWalls(subDt, onCollision);

      // 横方向の場外フェイルセーフ
      if (this.puck.pos.x < -20 || this.puck.pos.x > this.config.width + 20) {
        this.puck.pos.set(this.config.width * 0.5, this.config.height * 0.5);
        this.puck.vel.set(0, 0);
      }
    }

    return null;
  }

  /**
   * 壁衝突を「衝突時刻(TOI)の早い順」に解きながら、サブステップ分だけパックを進める。
   *
   * 反射してから改めてサブステップ全体を積分すると、跳ね返った瞬間の位置が
   * 壁の手前ではなく「壁にぶつかる前の位置 + 反射後の速度 × 全時間」になり、
   * 1回のバウンドで最大で半径ぶん近い誤差が出る。予測器 ([[puckPredictor]]) が
   * 同じ軌道を再現できなくなると、エージェントは読んでいるのに当たらなくなるため、
   * ここは衝突時刻で区切って積分する。
   */
  private advanceWithWalls(subDt: number, onCollision?: (event: CollisionEvent) => void): void {
    let remaining = subDt;

    // 同一サブステップ内での多重衝突 (コーナー) は数回で必ず打ち切る
    for (let guard = 0; guard < 4 && remaining > 1e-9; guard++) {
      let earliest: ContactManifold | null = null;
      let earliestWall: WallSegment | null = null;

      for (const wall of this.walls) {
        const manifold = sweepCircleVsSegment(this.puck.pos, this.puck.vel, this.puck.radius, wall, remaining);
        if (manifold && (!earliest || manifold.timeOfImpact < earliest.timeOfImpact)) {
          earliest = manifold;
          earliestWall = wall;
        }
      }

      if (!earliest || !earliestWall) break;

      // 衝突の瞬間まで進める
      const toi = earliest.timeOfImpact * remaining;
      if (toi > 0) {
        this.puck.pos = this.puck.pos.add(this.puck.vel.scale(toi));
        remaining -= toi;
      }

      // 法線成分だけを反発係数で跳ね返す。接線成分は壁の摩擦ぶんだけ落とす。
      // 速度ベクトル全体に反発係数を掛けると、擦るようなバウンドでも
      // 速度が一律に落ちてラリーが不自然に失速する。
      const normal = earliest.normal;
      const vn = this.puck.vel.dot(normal);
      if (vn < 0) {
        const tangentVel = this.puck.vel.sub(normal.scale(vn));
        const tangentKeep = 1 - earliestWall.material.friction * 0.5;
        this.puck.vel = tangentVel
          .scale(tangentKeep)
          .add(normal.scale(-vn * earliestWall.material.restitution));

        // 接線方向の摩擦はスピンに変わる
        this.puck.spin += tangentVel.dot(new Vec2(-normal.y, normal.x)) * 0.0004;
      }

      // めり込みの解消
      if (earliest.penetration > 0) {
        this.puck.pos = this.puck.pos.add(normal.scale(earliest.penetration + 0.05));
      } else {
        this.puck.pos = this.puck.pos.add(normal.scale(0.01));
      }

      if (onCollision) {
        onCollision({
          type: "PUCK_WALL",
          pos: earliest.point,
          impactSpeed: this.puck.vel.mag(),
        });
      }
    }

    if (remaining > 0) {
      this.puck.pos = this.puck.pos.add(this.puck.vel.scale(remaining));
    }
  }

  private checkMalletCollision(
    mallet: CircleBody,
    eventType: CollisionEvent["type"],
    subDt: number,
    onCollision?: (event: CollisionEvent) => void
  ): void {
    const manifold = sweepCircleVsCircle(
      this.puck.pos,
      this.puck.vel,
      this.puck.radius,
      mallet.pos,
      mallet.vel,
      mallet.radius,
      subDt
    );

    if (manifold) {
      // インパルス応答。マレットのスイング速度はここで相対速度として転写されるため、
      // これとは別にスイング分を加算してはならない (運動量の2重計上になる)
      resolveCollisionImpulse(this.puck, mallet, manifold);

      // 速度制限はサブステップの先頭でしか掛かっていないので、衝突で跳ね上がった
      // ぶんをここで抑える。予測器 ([[puckPredictor]]) は maxPuckSpeed を守る
      // 前提で積分しているため、ここを放置すると読みがずれる
      const boosted = this.puck.vel.mag();
      if (boosted > this.config.maxPuckSpeed) {
        this.puck.vel = this.puck.vel.scale(this.config.maxPuckSpeed / boosted);
      }

      // 重なり分離 (Penetration resolution)
      const targetDist = this.puck.radius + mallet.radius;
      const curDist = this.puck.pos.dist(mallet.pos);
      if (curDist < targetDist) {
        const overlap = targetDist - curDist + 0.5;
        this.puck.pos = this.puck.pos.add(manifold.normal.scale(overlap));
      }

      if (onCollision) {
        onCollision({
          type: eventType,
          pos: manifold.point,
          impactSpeed: this.puck.vel.mag(),
        });
      }
    }
  }

  /** パック・マレットのリセット */
  resetPositions(servingSide: "PLAYER" | "JEV" = "PLAYER"): void {
    const { width, height } = this.config;
    const isPlayerServing = servingSide === "PLAYER";
    const puckY = isPlayerServing ? height * 0.65 : height * 0.35;

    // パック初期位置
    this.puck.pos.set(width * 0.5, puckY);
    // 相手側またはサーブ側へ向けて穏やかな初期サーブ速度を付与 (ボール停止防止)
    const randomAngle = (Math.random() - 0.5) * 120;
    const serveDirY = isPlayerServing ? -240 : 240;
    this.puck.vel.set(randomAngle, serveDirY);
    this.puck.spin = 0;

    this.playerMallet.pos.set(width * 0.5, height * 0.85);
    this.playerMallet.vel.set(0, 0);

    this.jevMallet.pos.set(width * 0.5, height * 0.15);
    this.jevMallet.vel.set(0, 0);
  }
}
