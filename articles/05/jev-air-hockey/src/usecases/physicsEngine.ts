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

    for (let stepIdx = 0; stepIdx < this.subSteps; stepIdx++) {
      // 1. パックの速度に摩擦とスピン効果を適用
      const subFriction = Math.pow(this.puck.material.airResistance, 1 / this.subSteps);
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
      const nextY = this.puck.pos.y + this.puck.vel.y * subDt;

      // Jevゴール (上部 y=0 ライン交差)
      if (
        (this.puck.vel.y < 0 && this.puck.pos.y >= 0 && nextY <= 0 && this.puck.pos.x >= goalLeft - 10 && this.puck.pos.x <= goalRight + 10) ||
        (this.puck.pos.y < 0 && this.puck.pos.x >= goalLeft - 20 && this.puck.pos.x <= goalRight + 20) ||
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
        (this.puck.vel.y > 0 && this.puck.pos.y <= this.config.height && nextY >= this.config.height && this.puck.pos.x >= goalLeft - 10 && this.puck.pos.x <= goalRight + 10) ||
        (this.puck.pos.y > this.config.height && this.puck.pos.x >= goalLeft - 20 && this.puck.pos.x <= goalRight + 20) ||
        this.puck.pos.y > this.config.height + 30
      ) {
        this.puck.vel.set(0, 0);
        if (onCollision) {
          onCollision({ type: "GOAL_JEV", pos: this.puck.pos.clone(), impactSpeed: currentSpeed });
        }
        return "GOAL_JEV";
      }

      // 4. 壁との連続衝突判定 (ゴール開口部以外の壁)
      for (const wall of this.walls) {
        const manifold = sweepCircleVsSegment(this.puck.pos, this.puck.vel, this.puck.radius, wall, subDt);
        if (manifold) {
          this.puck.vel = this.puck.vel.reflect(manifold.normal).scale(wall.material.restitution);
          this.puck.pos = this.puck.pos.add(manifold.normal.scale(manifold.penetration + 0.1));
          if (onCollision) {
            onCollision({
              type: "PUCK_WALL",
              pos: manifold.point,
              impactSpeed: this.puck.vel.mag(),
            });
          }
        }
      }

      // 5. パック位置の積分
      this.puck.pos = this.puck.pos.add(this.puck.vel.scale(subDt));

      // 横方向の場外フェイルセーフ
      if (this.puck.pos.x < -20 || this.puck.pos.x > this.config.width + 20) {
        this.puck.pos.set(this.config.width * 0.5, this.config.height * 0.5);
        this.puck.vel.set(0, 0);
      }
    }

    return null;
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
