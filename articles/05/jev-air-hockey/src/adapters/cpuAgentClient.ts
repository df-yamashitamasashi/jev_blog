/**
 * Local CPU Agent Client (Clean Architecture - Adapter Layer)
 *
 * 外部APIを一切使わない幾何解ソルバー。LLM勢の対照群(ベースライン)として、
 * 他エージェントと完全に同じ ShotPlan を返し、同じガードレールを通る。
 *
 * やっていることは人間の上級者の思考と同じ順序:
 *   1. パックの未来位置を壁反射込みで読む
 *   2. 直接シュート・左右のバンクシュート・クリアを候補として並べる
 *   3. それぞれ「打ったらどう飛ぶか」を実際に積分し、決まるか・相手に取られるかで採点
 *   4. 最良の一手を宣言する
 * 乱数は一切使わない (同じ盤面なら常に同じ判断 = 再現可能なベンチマーク)。
 */

import { AgentType, AgentTelemetry, MindGameChat } from "../domain/jevAgentTypes";
import { validateShotPlan } from "../domain/shotPlanValidator";
import { predictPuckPath } from "../domain/puckPredictor";
import { limitsFor } from "../domain/interception";
import {
  EvaluateContext,
  ScoredShot,
  buildClearCandidate,
  buildShotCandidates,
  evaluateShot,
  pickBestShot,
} from "../domain/shotTactics";
import { IAgentClient, AirHockeyObservation } from "./agentClient";

/** 判断に使う予測の地平線 (秒) */
const LOOKAHEAD_SEC = 2.0;

export class CpuAgentClient implements IAgentClient {
  readonly type = AgentType.CPU;
  readonly usesLiveApi = false;

  private lastChatTime = 0;

  async decideShot(obs: AirHockeyObservation): Promise<AgentTelemetry> {
    const started = performance.now();
    const { config, side } = obs;

    const traj = predictPuckPath(obs.puckPos, obs.puckVel, config, { horizonSec: LOOKAHEAD_SEC });
    const limits = limitsFor(side, config);

    const ctx: EvaluateContext = {
      side,
      config,
      limits,
      malletPos: obs.myMalletPos,
      malletVel: obs.myMalletVel,
      opponentMalletPos: obs.opponentMalletPos,
      opponentMalletVel: obs.opponentMalletVel,
      swingSpeed: config.maxMalletSpeed,
    };

    // 得点を狙う候補をすべて採点し、最良の一手を選ぶ
    let best = pickBestShot(traj, buildShotCandidates(side, config), ctx, LOOKAHEAD_SEC);

    // どれも決まらないなら、確実に自陣から追い出すクリアと比べる
    const clear = evaluateShot(traj, buildClearCandidate(side, config, obs.opponentMalletPos), ctx, LOOKAHEAD_SEC);
    if (clear && (!best || clear.score > best.score)) best = clear;

    if (!best) {
      // 迎撃解が1つも立たない = この局面では打ち返せない。計画を出さずに守りへ回す
      return {
        plan: null,
        status: "INVALID",
        rawLatencyMs: performance.now() - started,
        clampNotes: ["到達可能な迎撃点が存在しない"],
        isLiveApi: false,
        latestChat: null,
      };
    }

    const { solution, candidate } = best;
    const swingDirDeg = (Math.atan2(solution.swingDir.y, solution.swingDir.x) * 180) / Math.PI;

    const result = validateShotPlan(
      {
        interceptPoint: { x: solution.contactPoint.x, y: solution.contactPoint.y },
        aimPoint: { x: candidate.aimPoint.x, y: candidate.aimPoint.y },
        swingDirDeg,
        swingSpeed: solution.swingSpeed,
        comment: this.pickChat(best),
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

  /** 選んだ手の内容をそのまま実況にする (演出のためだけの乱数は使わない) */
  private pickChat(shot: ScoredShot): string | undefined {
    const now = performance.now();
    if (now - this.lastChatTime < 4000) return undefined;
    this.lastChatTime = now;

    if (shot.goalInSec !== null) {
      const ms = Math.round(shot.goalInSec * 1000);
      switch (shot.candidate.kind) {
        case "BANK_LEFT":
          return `[CPU] 左バンク。${ms}ms後に決まる解を選択。`;
        case "BANK_RIGHT":
          return `[CPU] 右バンク。${ms}ms後に決まる解を選択。`;
        case "CLEAR":
          return `[CPU] クリアがそのまま通る。${ms}ms後に到達。`;
        default:
          return `[CPU] 直接シュート。${ms}ms後に枠内へ。`;
      }
    }

    if (shot.candidate.kind === "CLEAR") {
      return "[CPU] 得点解なし。自陣から確実に追い出します。";
    }
    if (!shot.solution.feasible) {
      return `[CPU] ${Math.round(-shot.solution.slackSec * 1000)}ms 足りない。全力で追います。`;
    }
    return "[CPU] 決定解なし。相手の届かない位置へ通します。";
  }

  private buildChat(comment: string | undefined): MindGameChat | null {
    if (!comment) return null;
    return { text: comment, category: "CALCULATE", timestamp: Date.now() };
  }
}
