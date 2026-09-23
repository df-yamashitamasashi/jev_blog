/**
 * Servo Motion Smoothness Tests (Vitest)
 *
 * 見た目の「なめらかさ」は、マレットの速度が1ステップでどれだけ飛ぶかで決まる。
 * 作り直し前は、静止した迎撃点へ全速で突っ込んでは行き過ぎて戻る往復運動が出ており、
 * 1秒間に何度も進行方向が反転していた。
 *
 * 制御による速度変化は必ず最大加速度以内に収まり、方向の反転は起きないことを固定する
 * (衝突のインパルスと、ゴール後のリセットは制御ではないので対象外)。
 */

import { describe, it, expect } from "vitest";
import { GameLoopUseCase } from "../src/usecases/gameLoopUseCase";
import { PhysicsEngine } from "../src/usecases/physicsEngine";
import { AgentBrainUseCase } from "../src/usecases/agentBrainUseCase";
import { CpuAgentClient } from "../src/adapters/cpuAgentClient";
import { AgentType } from "../src/domain/jevAgentTypes";
import { DEFAULT_STADIUM_CONFIG as CFG } from "../src/domain/gameState";
import { ISoundSynthesizer } from "../src/adapters/soundSynthesizer";
import { CollisionEvent } from "../src/usecases/physicsEngine";

class SilentSound implements ISoundSynthesizer {
  playHitPuck = () => {};
  playWallBounce = () => {};
  playSmashHit = () => {};
  playGoal = () => {};
  playCountDown = () => {};
  toggleBgm = () => {};
  isBgmActive = () => false;
}

describe("Servo motion smoothness", () => {
  it("should never jerk or oscillate while tracking the puck", async () => {
    const physics = new PhysicsEngine(CFG);
    const topBrain = new AgentBrainUseCase(new CpuAgentClient(), CFG, "TOP", AgentType.CPU);
    const loop = new GameLoopUseCase(physics, topBrain, new SilentSound(), CFG, AgentType.CPU, AgentType.CPU);

    // 1回の advance で物理1ステップだけ進むようにする (思考予算の一括消費を避ける)
    loop.setFairTiming(false);

    let contacted = false;
    let scored = false;
    loop.setCallbacks(
      (state) => {
        if (state.lastScorer !== null) scored = true;
      },
      (event: CollisionEvent) => {
        if (event.type === "PUCK_MALLET_JEV") contacted = true;
      }
    );

    loop.startMatch(7, 7);

    const mallet = physics.getJevMallet();
    let prevVel = mallet.vel.clone();
    let reversals = 0;
    let worstAccel = 0;
    let moved = 0;
    let samples = 0;
    let contactedBefore = false;

    const limits = {
      minX: CFG.malletRadius,
      maxX: CFG.width - CFG.malletRadius,
      minY: CFG.malletRadius,
      maxY: CFG.height * 0.48,
    };

    for (let i = 0; i < 2600; i++) {
      contacted = false;
      scored = false;
      await loop.advance(1);

      const vel = mallet.vel.clone();
      if (vel.mag() > 30) moved++;

      // 制御以外で速度が変わる要因は除外する
      const atBoundary =
        mallet.pos.x <= limits.minX + 1 ||
        mallet.pos.x >= limits.maxX - 1 ||
        mallet.pos.y <= limits.minY + 1 ||
        mallet.pos.y >= limits.maxY - 1;

      // 衝突直後のステップも除く。インパルスでマレットが最高速を超えて弾かれ、
      // サーボがそれを制限速度へ戻す変化は制御によるものではない
      if (!contacted && !contactedBefore && !scored && !atBoundary) {
        worstAccel = Math.max(worstAccel, vel.sub(prevVel).mag() / CFG.fixedDt);
        // 走っている最中に1ステップで進行方向が逆転したらカクつきとして数える
        if (vel.mag() > 60 && prevVel.mag() > 60 && vel.dot(prevVel) < 0) reversals++;
        samples++;
      }

      prevVel = vel;
      contactedBefore = contacted;
    }

    expect(samples).toBeGreaterThan(1500);
    // ちゃんと動いていること (静止したまま滑らかでも意味がない)
    expect(moved / 2600).toBeGreaterThan(0.4);
    // 制御による速度変化は最大加速度の範囲内 (数値誤差ぶんだけ許容)
    expect(worstAccel).toBeLessThan(CFG.maxMalletAccel * 1.05);
    // 往復振動が起きていないこと
    expect(reversals).toBe(0);
  }, 60000);
});
