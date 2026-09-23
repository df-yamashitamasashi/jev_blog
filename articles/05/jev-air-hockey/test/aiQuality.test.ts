/**
 * AI Play Quality Regression Tests (Vitest)
 *
 * 「動きが壊れている」を主観で語らないための土台。CPU同士の自己対戦を複数シードで
 * 回し、得点ペース・セーブ率・狙いの精度を数値で固定する。
 *
 * 作り直し前の同じ計測値 (参考):
 *   得点 0.78/分 / セーブ率 85.6% / 狙い誤差 37〜52° / 最大打球 1117 px/s
 *   → 400ラリー・154秒かけて2点しか入らない膠着状態だった。
 *
 * 判断を「中央線で1回だけ」にしてからの計測値:
 *   得点 16.7/分 / セーブ率 99.2% / 狙い誤差 8.6°
 * 間に合う手が1つでもあれば必ず打ちに行く (壁沿いの球にはバンクで当てる)。
 * 以前は間に合わない直接シュートを最良と判断して計画ごと捨て、壁沿いを往復する
 * 球に一切手を出さなかったため、得点は 2.4/分 まで落ちていた。
 */

import { describe, it, expect } from "vitest";
import { GameLoopUseCase } from "../src/usecases/gameLoopUseCase";
import { PhysicsEngine } from "../src/usecases/physicsEngine";
import { AgentBrainUseCase } from "../src/usecases/agentBrainUseCase";
import { CpuAgentClient } from "../src/adapters/cpuAgentClient";
import { AgentType } from "../src/domain/jevAgentTypes";
import { DEFAULT_STADIUM_CONFIG as CFG } from "../src/domain/gameState";
import { ISoundSynthesizer } from "../src/adapters/soundSynthesizer";

class SilentSound implements ISoundSynthesizer {
  playHitPuck = () => {};
  playWallBounce = () => {};
  playSmashHit = () => {};
  playGoal = () => {};
  playCountDown = () => {};
  toggleBgm = () => {};
  isBgmActive = () => false;
}

const RALLY_CAP = 1400;

async function selfPlay(seed: number) {
  const physics = new PhysicsEngine(CFG);
  const topBrain = new AgentBrainUseCase(new CpuAgentClient(), CFG, "TOP", AgentType.CPU);
  const loop = new GameLoopUseCase(physics, topBrain, new SilentSound(), CFG, AgentType.CPU, AgentType.CPU);

  loop.setFairTiming(true);
  // 実際の試合と同じく、作戦タイム → カウントダウン → サーブ の順で始める
  await loop.prepareMatch(7, seed, RALLY_CAP);

  for (let i = 0; i < 9000 && !loop.isFinished(); i++) {
    await loop.advance(60);
  }

  return { state: loop.getMatchState(), stats: loop.getStats(), finished: loop.isFinished() };
}

describe("CPU self-play quality", () => {
  it("should play a decisive, high-precision match on every seed", async () => {
    const seeds = [1, 7, 42, 99, 2024, 31337];

    let goals = 0;
    let seconds = 0;
    let saves = 0;
    let whiffs = 0;
    let aimSum = 0;
    let aimSamples = 0;
    let peakPuckSpeed = 0;
    let topGoals = 0;
    let bottomGoals = 0;

    for (const seed of seeds) {
      const { state, stats, finished } = await selfPlay(seed);

      // 決着すること。ラリー上限で打ち切られるのは膠着 = 攻め手が無いということ
      expect(finished).toBe(true);
      console.log(`  seed ${seed}: ${state.score.jev}-${state.score.player} ${state.matchDurationSec.toFixed(0)}s rallies=${state.rallyCount}`);
      expect(state.rallyCount).toBeLessThan(RALLY_CAP);

      goals += state.score.jev + state.score.player;
      topGoals += state.score.jev;
      bottomGoals += state.score.player;
      seconds += state.matchDurationSec;
      peakPuckSpeed = Math.max(peakPuckSpeed, state.maxSpeedReached);

      for (const side of [stats.top, stats.bottom]) {
        saves += side.saves;
        whiffs += side.whiffs;
        aimSum += side.aimErrorSumDeg;
        aimSamples += side.aimErrorSamples;
        // 同じ実装同士なので、どちらの側も必ず何度も打ち返しているはず
        expect(side.saves).toBeGreaterThan(5);
      }
    }

    const goalsPerMin = (goals / seconds) * 60;
    const saveRate = saves / (saves + whiffs);
    const aimErrorDeg = aimSum / Math.max(1, aimSamples);

    console.log(
      `goalsPerMin=${goalsPerMin.toFixed(2)} saveRate=${(saveRate * 100).toFixed(1)}% ` +
        `aimErr=${aimErrorDeg.toFixed(1)}deg peakPuck=${peakPuckSpeed} top/bottom=${topGoals}/${bottomGoals}`
    );

    // 攻め合いになっていること (作り直し前は 0.78/分)
    expect(goalsPerMin).toBeGreaterThan(6);
    // 守れていること (作り直し前は 85.6%)
    expect(saveRate).toBeGreaterThan(0.95);
    // 宣言した狙いどおりに飛んでいること (作り直し前は 37〜52°)。
    // 中央線で決めた計画を開ループで実行しても、予測が正しければ狙いは外れない
    expect(aimErrorDeg).toBeLessThan(12);
    // 止まったマレットに当てるだけの弱い打球で終わっていないこと
    expect(peakPuckSpeed).toBeGreaterThan(1700);

    // 上下は同じ実装。片側だけが勝ち続けるなら座標系の扱いに非対称がある
    const share = topGoals / Math.max(1, topGoals + bottomGoals);
    expect(share).toBeGreaterThan(0.2);
    expect(share).toBeLessThan(0.8);
  }, 300000);
});
