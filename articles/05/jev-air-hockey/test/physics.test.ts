/**
 * High-Precision Physics Engine Unit Tests (Vitest)
 */

import { describe, it, expect } from "vitest";
import {
  Vec2,
  CircleBody,
  sweepCircleVsCircle,
  sweepCircleVsSegment,
  resolveCollisionImpulse,
  WallSegment,
} from "../src/domain/physics";
import { PhysicsEngine } from "../src/usecases/physicsEngine";
import { DEFAULT_STADIUM_CONFIG } from "../src/domain/gameState";

describe("High-Precision Physics Engine", () => {
  describe("Vec2 Math", () => {
    it("should calculate reflection vector correctly", () => {
      // (1, 1) が Y軸法線 (0, -1) に衝突して (1, -1) に反射
      const v = new Vec2(1, 1);
      const normal = new Vec2(0, -1);
      const reflected = v.reflect(normal);
      expect(reflected.x).toBeCloseTo(1);
      expect(reflected.y).toBeCloseTo(-1);
    });

    it("should normalize correctly", () => {
      const v = new Vec2(3, 4);
      const norm = v.normalize();
      expect(norm.mag()).toBeCloseTo(1.0);
      expect(norm.x).toBeCloseTo(0.6);
      expect(norm.y).toBeCloseTo(0.8);
    });
  });

  describe("Continuous Collision Detection (CCD)", () => {
    it("should detect circle-circle impact time before collision occurs", () => {
      // 円A (0, 0) から (100, 0) に向かう (速度 1000px/s, dt=0.05s → 50px移動)
      // 円B (40, 0) 静止
      // 半径各10px (接触距離 20px)
      const posA = new Vec2(0, 0);
      const velA = new Vec2(1000, 0);
      const posB = new Vec2(40, 0);
      const velB = new Vec2(0, 0);

      const manifold = sweepCircleVsCircle(posA, velA, 10, posB, velB, 10, 0.05);
      expect(manifold).not.toBeNull();
      // 接触距離20pxに到達する位置 = x=20。移動量 50px のうち 20px なので t = 20/50 = 0.4
      expect(manifold!.timeOfImpact).toBeCloseTo(0.4, 2);
    });

    it("should detect circle-segment wall impact time correctly", () => {
      // パック (50, 0) から (50, 100) に向かって高速移動 (半径10px)
      // 壁: y = 80 の水平壁 (法線 (0, -1))
      const pos = new Vec2(50, 0);
      const vel = new Vec2(0, 1000);
      const wall: WallSegment = {
        p1: new Vec2(0, 80),
        p2: new Vec2(100, 80),
        normal: new Vec2(0, -1),
        material: { restitution: 1.0, friction: 0, airResistance: 1.0 },
      };

      // dt = 0.1s (100px移動して y=100 に達する)
      // パック端が y=70 (80 - 10) に達する時刻 t = 70 / 100 = 0.7
      const manifold = sweepCircleVsSegment(pos, vel, 10, wall, 0.1);
      expect(manifold).not.toBeNull();
      expect(manifold!.timeOfImpact).toBeCloseTo(0.7, 2);
    });
  });

  describe("Rigid Body Impulse & Momentum", () => {
    it("should conserve momentum and transfer velocity upon elastic collision", () => {
      const bodyA: CircleBody = {
        id: "a",
        pos: new Vec2(0, 0),
        vel: new Vec2(100, 0),
        radius: 10,
        mass: 1.0,
        spin: 0,
        material: { restitution: 1.0, friction: 0, airResistance: 1.0 },
      };
      const bodyB: CircleBody = {
        id: "b",
        pos: new Vec2(20, 0),
        vel: new Vec2(0, 0),
        radius: 10,
        mass: 1.0,
        spin: 0,
        material: { restitution: 1.0, friction: 0, airResistance: 1.0 },
      };

      const manifold = {
        timeOfImpact: 0,
        point: new Vec2(10, 0),
        normal: new Vec2(-1, 0), // BからAへの法線
        penetration: 0,
      };

      resolveCollisionImpulse(bodyA, bodyB, manifold);

      // 完全弾性衝突かつ等質量なので、Aの速度が0になり、Bが100で発射される
      expect(bodyA.vel.x).toBeCloseTo(0);
      expect(bodyB.vel.x).toBeCloseTo(100);
    });
  });

  describe("Energy Guardrails", () => {
    const makeBody = (
      id: string,
      pos: Vec2,
      vel: Vec2,
      radius: number,
      mass: number,
      restitution: number
    ): CircleBody => ({
      id,
      pos,
      vel,
      radius,
      mass,
      spin: 0,
      material: { restitution, friction: 0.2, airResistance: 1.0 },
    });

    it("should never let the configured restitution exceed 1.0", () => {
      // 1.0 を超えると衝突のたびにエネルギーが増える (非物理的)
      expect(DEFAULT_STADIUM_CONFIG.malletRestitution).toBeLessThanOrEqual(1.0);
      expect(DEFAULT_STADIUM_CONFIG.wallRestitution).toBeLessThanOrEqual(1.0);
    });

    it("should satisfy the restitution invariant for arbitrary impacts", () => {
      // 反発係数の定義: 法線方向の分離速度 <= e * 接近速度
      for (let i = 0; i < 200; i++) {
        const e = 0.3 + Math.random() * 0.7;
        const puckVel = new Vec2((Math.random() - 0.5) * 3000, (Math.random() - 0.5) * 3000);
        const malletVel = new Vec2((Math.random() - 0.5) * 1800, (Math.random() - 0.5) * 1800);

        const puck = makeBody("puck", new Vec2(54, 0), puckVel.clone(), 20, 0.05, e);
        const mallet = makeBody("mallet", new Vec2(0, 0), malletVel.clone(), 34, 0.35, e);

        const normal = new Vec2(1, 0); // マレットからパックへ
        const approach = puckVel.sub(malletVel).dot(normal);
        if (approach > 0) continue; // 離れていく場合は衝突解決されない

        resolveCollisionImpulse(puck, mallet, {
          timeOfImpact: 0,
          point: new Vec2(20, 0),
          normal,
          penetration: 0,
        });

        const separation = puck.vel.sub(mallet.vel).dot(normal);
        expect(separation).toBeLessThanOrEqual(Math.abs(approach) * e + 1e-6);
      }
    });

    it("should produce the analytically correct puck speed for a max-speed swing", () => {
      const { malletRestitution: e, puckMass, malletMass, maxMalletSpeed: v } = DEFAULT_STADIUM_CONFIG;

      const puck = makeBody("puck", new Vec2(54, 0), new Vec2(0, 0), 20, puckMass, e);
      const mallet = makeBody("mallet", new Vec2(0, 0), new Vec2(v, 0), 34, malletMass, e);

      resolveCollisionImpulse(puck, mallet, {
        timeOfImpact: 0,
        point: new Vec2(20, 0),
        normal: new Vec2(1, 0),
        penetration: 0,
      });

      // j = (1+e)v / (1/mp + 1/mm), パック出速 = j / mp
      const j = ((1 + e) * v) / (1 / puckMass + 1 / malletMass);
      expect(puck.vel.x).toBeCloseTo(j / puckMass, 4);
      // 静止パックへの最大スイングでも安全網 maxPuckSpeed を下回る
      expect(puck.vel.x).toBeLessThan(DEFAULT_STADIUM_CONFIG.maxPuckSpeed);
    });

    it("should strictly lose energy while rallying off walls with no mallet contact", () => {
      const engine = new PhysicsEngine(DEFAULT_STADIUM_CONFIG);
      const puck = engine.getPuck();

      // マレットを衝突しない隅へ退避させる
      engine.getPlayerMallet().pos.set(40, DEFAULT_STADIUM_CONFIG.height - 40);
      engine.getJevMallet().pos.set(40, 40);

      puck.pos.set(DEFAULT_STADIUM_CONFIG.width * 0.5, DEFAULT_STADIUM_CONFIG.height * 0.5);
      puck.vel.set(900, 140); // ゴールを避けるため横方向主体
      const initialSpeed = puck.vel.mag();

      let previousSpeed = initialSpeed;
      for (let frame = 0; frame < 120; frame++) {
        if (engine.step(1 / 120)) break; // ゴールしたら打ち切り
        const speed = puck.vel.mag();
        expect(speed).toBeLessThanOrEqual(previousSpeed + 1e-6);
        previousSpeed = speed;
      }

      expect(previousSpeed).toBeLessThan(initialSpeed);
    });
  });

  describe("Tunneling Prevention & Goal Detection", () => {
    it("should prevent fast puck from tunneling through walls", () => {
      const engine = new PhysicsEngine(DEFAULT_STADIUM_CONFIG);
      const puck = engine.getPuck();

      // パックを超高速 (2400px/s) で右壁に向けて発射
      puck.pos.set(DEFAULT_STADIUM_CONFIG.width - 30, 300);
      puck.vel.set(2400, 0);

      // 1フレーム分 (16.6ms) シミュレーション
      engine.step(0.0166);

      // サブステップCCDにより、右壁を突き抜けずに跳ね返り、X速度が反転していること
      expect(puck.vel.x).toBeLessThan(0);
      expect(puck.pos.x).toBeLessThan(DEFAULT_STADIUM_CONFIG.width);
    });

    it("should reliably detect high-speed diagonal goal without vanishing", () => {
      const engine = new PhysicsEngine(DEFAULT_STADIUM_CONFIG);
      const puck = engine.getPuck();

      // Jev上部ゴール (幅220px: 190 ~ 410) の端に向かって斜め高速ショット (25pxから-36.5px移動してy=0を交差)
      puck.pos.set(200, 25);
      puck.vel.set(100, -2200); // 上向き超高速

      // 1ステップ実行
      const goal = engine.step(0.0166);
      expect(goal).toBe("GOAL_PLAYER");
      // 速度が安全に停止されていること
      expect(puck.vel.mag()).toBe(0);
    });

    it("should reliably detect bottom goal when crossing bottom goal line", () => {
      const engine = new PhysicsEngine(DEFAULT_STADIUM_CONFIG);
      const puck = engine.getPuck();

      // 下部ゴールに向かって高速ショット
      puck.pos.set(DEFAULT_STADIUM_CONFIG.width * 0.5, DEFAULT_STADIUM_CONFIG.height - 30);
      puck.vel.set(0, 2000); // 下向き高速

      const goal = engine.step(0.0166);
      expect(goal).toBe("GOAL_JEV");
      expect(puck.vel.mag()).toBe(0);
    });
  });
});
