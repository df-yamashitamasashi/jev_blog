/**
 * Local CPU Agent Client (Clean Architecture - Adapter Layer)
 *
 * 外部APIを一切使わない幾何解ソルバー。LLM勢の対照群(ベースライン)として、
 * 他エージェントと完全に同じ ShotPlan を返し、同じガードレールを通る。
 *
 * やっていることは人間の上級者の思考と同じ順序:
 *   1. パックの未来位置を壁反射込みで読む
 *   2. 直接シュート・左右のバンクシュート・クリアを候補として並べる
 *   3. 飛んでくる球をそのまま打つか、壁で跳ね返ったあとを打つかの両方について、
 *      「打ったらどう飛ぶか」を実際に積分し、決まるか・相手に取られるかで採点
 *   4. 最良の一手について、構え位置までの経路 (直線/曲線) と速度を決めて宣言する
 * 乱数は一切使わない (同じ盤面なら常に同じ判断 = 再現可能なベンチマーク)。
 */

import { AgentType, AgentTelemetry, MindGameChat } from "../domain/jevAgentTypes";
import { validateShotPlan } from "../domain/shotPlanValidator";
import { PuckTrajectory, predictPuckPath } from "../domain/puckPredictor";
import { limitsFor, travelTime } from "../domain/interception";
import { chooseApproach } from "../domain/approachPath";
import {
  EvaluateContext,
  ScoredShot,
  ShotKind,
  buildClearCandidate,
  buildShotCandidates,
  evaluateShot,
} from "../domain/shotTactics";
import { IAgentClient, AirHockeyObservation, PlaybookContext, PlaybookTelemetry } from "./agentClient";
import { CpuStyle, PlaybookMove } from "../domain/playbook";
import { toPlaybookTelemetry } from "./llmShotPlanner";

/** 判断に使う予測の地平線 (秒) */
const LOOKAHEAD_SEC = 2.0;


/**
 * CPU の動作パターンごとの味付け。BALANCED が素の CPU (対照群) で、他はその採点を
 * 少しずつ傾けたもの。作戦に当てはまる手が無い局面で AI が CPU に任せるとき、
 * AI 自身が作戦タイムに選んだパターンで動く。
 */
interface StyleTuning {
  /** 検討する打ち方の種類 (該当する手が1つも立たなければ全種類に広げる) */
  kinds: ShotKind[] | "ALL";
  /** スイング速度 (null なら最大) */
  swingSpeed: number | null;
  /** 決まる球に上乗せする点 */
  goalBonus: number;
  /** 逃がす球 (CLEAR) に上乗せする点 */
  clearBonus: number;
  /** 打点の時刻 1 秒あたりの加点。負なら早い打点ほど良い */
  timeBias: number;
  /** 壁の跳ね返りを打つ手に上乗せする点 */
  reboundBonus: number;
  /** ゴール中央付近を狙う手に上乗せする点 (最大値) */
  centerBonus: number;
  /** 相手マレットから遠い所を狙う手に上乗せする点 (最大値) */
  awayBonus: number;
  /** 自陣ゴールへ来る球は打ちに行かず、進路を塞ぐ */
  blockWhenThreatened: boolean;
}

const BASE_TUNING: StyleTuning = {
  kinds: "ALL",
  swingSpeed: null,
  goalBonus: 0,
  clearBonus: 0,
  timeBias: 0,
  reboundBonus: 0,
  centerBonus: 0,
  awayBonus: 0,
  blockWhenThreatened: false,
};

const STYLE_TUNING: Record<CpuStyle, StyleTuning> = {
  BALANCED: BASE_TUNING,
  ATTACK_FIRST: { ...BASE_TUNING, kinds: ["DIRECT", "BANK_LEFT", "BANK_RIGHT"], goalBonus: 600 },
  DEFENSE_FIRST: { ...BASE_TUNING, clearBonus: 500, blockWhenThreatened: true },
  COUNTER: { ...BASE_TUNING, timeBias: -1500 },
  PATIENT: { ...BASE_TUNING, timeBias: 500, reboundBonus: 300 },
  BANK_SHOOTER: { ...BASE_TUNING, kinds: ["BANK_LEFT", "BANK_RIGHT"], goalBonus: 200 },
  STRAIGHT_SHOOTER: { ...BASE_TUNING, kinds: ["DIRECT"] },
  SAFE_CLEAR: { ...BASE_TUNING, kinds: ["CLEAR"] },
  POWER: { ...BASE_TUNING, kinds: ["DIRECT"], centerBonus: 300 },
  SOFT_CONTROL: { ...BASE_TUNING, swingSpeed: 650, awayBonus: 400 },
};

/** 作戦の1手を短く書くための関数 */
const move = (
  strikeTiming: PlaybookMove["strikeTiming"],
  depth: PlaybookMove["depth"],
  aim: PlaybookMove["aim"],
  path: PlaybookMove["path"],
  moveSpeed: number,
  swingSpeed: number
): PlaybookMove => ({ strikeTiming, depth, aim, path, moveSpeed, swingSpeed });

/**
 * CPU の作戦。乱数を使わない固定の約束事 (同じ条件なら毎回同じ作戦)。
 * 方針: ゴールへ向かう球と速い球は構えが間に合う最初の点で相手の逆を突く。
 * 壁際の球はその壁を使ったバンクで返し、ゴール前・隅の球はまず大きく逃がす。
 */
const CPU_PLAYBOOK = {
  summary: "速い球は最速で逆を突き、壁際はバンク、ゴール前はまず逃がす",
  cpuStyle: "BALANCED",
  incoming: {
    THREAT_FAST: move("DIRECT", "EARLY", "AWAY_FROM_OPPONENT", "STRAIGHT", 1050, 1050),
    THREAT_SLOW: move("DIRECT", "EARLY", "AWAY_FROM_OPPONENT", "STRAIGHT", 1050, 1050),
    BANK_FROM_LEFT: move("REBOUND", "EARLY", "GOAL_RIGHT", "STRAIGHT", 900, 1050),
    BANK_FROM_RIGHT: move("REBOUND", "EARLY", "GOAL_LEFT", "STRAIGHT", 900, 1050),
    FAST_LEFT: move("DIRECT", "EARLY", "BANK_LEFT", "STRAIGHT", 1050, 1050),
    FAST_CENTER: move("DIRECT", "EARLY", "AWAY_FROM_OPPONENT", "STRAIGHT", 1050, 1050),
    FAST_RIGHT: move("DIRECT", "EARLY", "BANK_RIGHT", "STRAIGHT", 1050, 1050),
    SLOW_LEFT: move("DIRECT", "MID", "GOAL_RIGHT", "STRAIGHT", 750, 1050),
    SLOW_CENTER: move("DIRECT", "MID", "AWAY_FROM_OPPONENT", "STRAIGHT", 750, 1050),
    SLOW_RIGHT: move("DIRECT", "MID", "GOAL_LEFT", "STRAIGHT", 750, 1050),
  },
  lingering: {
    ROLLING_TO_GOAL: move("DIRECT", "EARLY", "CLEAR", "STRAIGHT", 1050, 900),
    NEAR_GOAL: move("DIRECT", "EARLY", "CLEAR", "STRAIGHT", 900, 900),
    CORNER_LEFT: move("DIRECT", "EARLY", "BANK_LEFT", "CURVE_RIGHT", 750, 1050),
    CORNER_RIGHT: move("DIRECT", "EARLY", "BANK_RIGHT", "CURVE_LEFT", 750, 1050),
    STOPPED_LEFT: move("DIRECT", "EARLY", "GOAL_RIGHT", "STRAIGHT", 750, 1050),
    STOPPED_CENTER: move("DIRECT", "EARLY", "AWAY_FROM_OPPONENT", "STRAIGHT", 750, 1050),
    STOPPED_RIGHT: move("DIRECT", "EARLY", "GOAL_LEFT", "STRAIGHT", 750, 1050),
    WALL_SHUTTLE_LEFT: move("DIRECT", "MID", "BANK_LEFT", "STRAIGHT", 1050, 1050),
    WALL_SHUTTLE_RIGHT: move("DIRECT", "MID", "BANK_RIGHT", "STRAIGHT", 1050, 1050),
    MOVING_OPEN: move("DIRECT", "EARLY", "AWAY_FROM_OPPONENT", "STRAIGHT", 900, 1050),
  },
};

/** 自陣に入ったパックが、再び自陣を出ていく時刻 (出ていかないなら null) */
function leavesOwnHalfAt(traj: PuckTrajectory, side: "TOP" | "BOTTOM", height: number): number | null {
  let entered = false;
  for (const sample of traj.samples) {
    const inOwnHalf = side === "TOP" ? sample.pos.y <= height * 0.52 : sample.pos.y >= height * 0.48;
    if (inOwnHalf) entered = true;
    else if (entered) return sample.t;
  }
  return null;
}

export class CpuAgentClient implements IAgentClient {
  readonly type = AgentType.CPU;
  readonly usesLiveApi = false;

  private lastChatTime = 0;

  /** style は CPU代行のときに AI が選んだ動作パターン。単独の CPU は BALANCED */
  constructor(private readonly style: CpuStyle = "BALANCED") {}

  /** 作戦タイム。CPU は固定の作戦を、他のエージェントと同じ検証に通して返す */
  async decidePlaybook(ctx: PlaybookContext): Promise<PlaybookTelemetry> {
    const started = performance.now();
    const { config, side } = ctx;
    return toPlaybookTelemetry(
      {
        ...CPU_PLAYBOOK,
        readyPosition: { x: config.width / 2, y: side === "TOP" ? config.height * 0.2 : config.height * 0.8 },
      },
      ctx,
      performance.now() - started,
      false
    );
  }

  async decideShot(obs: AirHockeyObservation): Promise<AgentTelemetry> {
    const started = performance.now();
    const { config, side } = obs;

    const traj = predictPuckPath(obs.puckPos, obs.puckVel, config, { horizonSec: LOOKAHEAD_SEC });
    const limits = limitsFor(side, config);
    const tuning = STYLE_TUNING[this.style];

    const ctx: EvaluateContext = {
      side,
      config,
      limits,
      malletPos: obs.myMalletPos,
      malletVel: obs.myMalletVel,
      opponentMalletPos: obs.opponentMalletPos,
      opponentMalletVel: obs.opponentMalletVel,
      swingSpeed: Math.min(config.maxMalletSpeed, tuning.swingSpeed ?? config.maxMalletSpeed),
    };

    const shots = buildShotCandidates(side, config);
    const clearCandidate = buildClearCandidate(side, config, obs.opponentMalletPos);

    /**
     * 打つ時間帯を2通り試す。
     *   DIRECT  — 最初の壁バウンドより前 (飛んでくる球をそのまま打つ)
     *   REBOUND — 最初の壁バウンドより後 (跳ね返った球を打つ)
     * 判断は中央線での1回きりなので、どちらを打つかもここで決め切る。
     */
    // 奥壁で跳ね返って相手陣へ戻っていくなら、そこから先は相手の番。打点の候補にしない
    const horizon = Math.min(LOOKAHEAD_SEC, leavesOwnHalfAt(traj, side, config.height) ?? LOOKAHEAD_SEC);
    const firstBounce = traj.bounceTimes.find((t) => t < horizon) ?? null;
    const windows: Array<{ ctx: EvaluateContext; maxSec: number }> = [
      { ctx, maxSec: firstBounce ?? horizon },
    ];
    if (firstBounce !== null) {
      windows.push({ ctx: { ...ctx, minContactSec: firstBounce + 0.02 }, maxSec: horizon });
    }

    /**
     * 間に合う手の中から最良を選ぶ。
     *
     * 全候補の最高点をそのまま採ると、間に合わない直接シュート (得点期待で高得点) が
     * 選ばれ、実行できる別の手 (壁際の球に対するバンクショットなど) があるのに
     * 何もしなくなる。左端の壁沿いを往復する球に一切手を出さない原因がこれだった。
     */
    const allCandidates = [...shots, clearCandidate];
    const styled =
      tuning.kinds === "ALL" ? allCandidates : allCandidates.filter((c) => (tuning.kinds as ShotKind[]).includes(c.kind));

    const search = (candidates: typeof allCandidates) => {
      let bestFeasible: ScoredShot | null = null;
      let bestChase: ScoredShot | null = null;
      for (const w of windows) {
        for (const candidate of candidates) {
          const shot = evaluateShot(traj, candidate, w.ctx, w.maxSec);
          if (!shot) continue;
          if (shot.solution.feasible) {
            const scored = { ...shot, score: this.styledScore(shot, firstBounce, obs) };
            if (!bestFeasible || scored.score > bestFeasible.score) bestFeasible = scored;
          } else if (!bestChase || shot.solution.slackSec > bestChase.solution.slackSec) {
            // 間に合わない手は、得点期待ではなく「最も惜しい」ものを残す
            bestChase = shot;
          }
        }
      }
      return { bestFeasible, bestChase };
    };

    // パターンが絞った打ち方で1つも立たなければ、全種類に広げる (必ず打ちに行く)
    let found = search(styled);
    if (!found.bestFeasible && styled.length < allCandidates.length) found = search(allCandidates);
    const { bestFeasible, bestChase } = found;

    /**
     * どれも間に合わなくても、パックには必ず打ちに行く。
     * ただし自陣ゴールへ向かう球だけは、届かない一撃を追うより進路を塞ぐ方が
     * 確実に触れる。計画を出さず、サーボの守備に任せる。
     * 防御優先のパターンは、間に合う手があってもゴールへ来る球は塞ぎに行く。
     */
    const threatened = traj.goalConcededBy === side;
    const best = threatened && tuning.blockWhenThreatened ? null : bestFeasible ?? (threatened ? null : bestChase);

    if (!best) {
      // 自陣ゴールへ向かう球に間に合う一撃が無い。計画を出さずに進路を塞ぐ
      return {
        plan: null,
        status: "OK",
        rawLatencyMs: performance.now() - started,
        clampNotes: ["ゴール防衛優先 (守備体制)"],
        isLiveApi: false,
        latestChat: null,
      };
    }

    const { solution, candidate } = best;
    const swingDirDeg = (Math.atan2(solution.swingDir.y, solution.swingDir.x) * 180) / Math.PI;
    const rebound = firstBounce !== null && solution.contactTime > firstBounce;

    // 構え位置 (打点の手前) までの経路。振り抜きに使う時間を差し引いた残りで着けばよい
    const windup = Math.min(150, (solution.swingSpeed * solution.swingSpeed) / (2 * limits.maxAccel));
    const windupPoint = solution.contactPoint.sub(solution.swingDir.scale(windup));
    const swingSec = travelTime(windup, 0, solution.swingSpeed, limits.maxAccel);
    const approach = chooseApproach(
      obs.myMalletPos,
      obs.myMalletVel,
      windupPoint,
      Math.max(0.05, solution.contactTime - swingSec),
      traj,
      limits,
      config
    );

    const result = validateShotPlan(
      {
        interceptPoint: { x: solution.contactPoint.x, y: solution.contactPoint.y },
        contactTimeMs: solution.contactTime * 1000,
        strikeTiming: rebound ? "REBOUND" : "DIRECT",
        aimPoint: { x: candidate.aimPoint.x, y: candidate.aimPoint.y },
        swingDirDeg,
        swingSpeed: solution.swingSpeed,
        movePath: approach.movePath,
        curveOffset: approach.curveOffset,
        moveSpeed: approach.moveSpeed,
        comment: this.pickChat(best, rebound),
      },
      side,
      config
    );

    return {
      plan: result.plan,
      status: result.status,
      rawLatencyMs: performance.now() - started,
      clampNotes: result.clampNotes,
      isLiveApi: false,
      latestChat: this.buildChat(result.plan?.comment),
    };
  }

  /** 動作パターンの味付けを加えた採点。BALANCED では素の採点と同じ */
  private styledScore(shot: ScoredShot, firstBounce: number | null, obs: AirHockeyObservation): number {
    const t = STYLE_TUNING[this.style];
    const { config } = obs;
    const target = shot.candidate.targetPoint;
    let score = shot.score;

    if (shot.goalInSec !== null) score += t.goalBonus;
    if (shot.candidate.kind === "CLEAR") score += t.clearBonus;
    score += t.timeBias * shot.solution.contactTime;
    if (firstBounce !== null && shot.solution.contactTime > firstBounce) score += t.reboundBonus;
    if (t.centerBonus) {
      const off = Math.abs(target.x - config.width / 2) / (config.goalWidth / 2);
      score += t.centerBonus * Math.max(0, 1 - off);
    }
    if (t.awayBonus) score += t.awayBonus * Math.min(1, Math.abs(target.x - obs.opponentMalletPos.x) / config.width);
    return score;
  }

  /** 選んだ手の内容をそのまま実況にする (演出のためだけの乱数は使わない) */
  private pickChat(shot: ScoredShot, rebound: boolean): string | undefined {
    const now = performance.now();
    if (now - this.lastChatTime < 4000) return undefined;
    this.lastChatTime = now;

    if (rebound && shot.goalInSec === null) {
      return "跳ね返りを待って打ちます。";
    }

    if (shot.goalInSec !== null) {
      const ms = Math.round(shot.goalInSec * 1000);
      switch (shot.candidate.kind) {
        case "BANK_LEFT":
          return `左バンク。${ms}ms後に決まる解を選択。`;
        case "BANK_RIGHT":
          return `右バンク。${ms}ms後に決まる解を選択。`;
        case "CLEAR":
          return `クリアがそのまま通る。${ms}ms後に到達。`;
        default:
          return `直接シュート。${ms}ms後に枠内へ。`;
      }
    }

    if (shot.candidate.kind === "CLEAR") {
      return "得点解なし。自陣から確実に追い出します。";
    }
    if (!shot.solution.feasible) {
      return `${Math.round(-shot.solution.slackSec * 1000)}ms 足りない。全力で追います。`;
    }
    return "決定解なし。相手の届かない位置へ通します。";
  }

  private buildChat(comment: string | undefined): MindGameChat | null {
    if (!comment) return null;
    return { text: comment, category: "CALCULATE", timestamp: Date.now() };
  }
}
