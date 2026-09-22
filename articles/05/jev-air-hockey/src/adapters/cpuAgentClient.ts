/**
 * Local CPU Agent Client (Clean Architecture - Adapter Layer)
 *
 * 外部APIを一切使わない幾何解ソルバー。LLM勢の対照群(ベースライン)として、
 * 他エージェントと完全に同じ ShotPlan を返し、同じガードレールを通る。
 */

import { AgentType, AgentTelemetry, MindGameChat } from "../domain/jevAgentTypes";
import { Vec2 } from "../domain/physics";
import { validateShotPlan } from "../domain/shotPlanValidator";
import {
  IAgentClient,
  AirHockeyObservation,
  predictCrossing,
  opponentGoalCenter,
} from "./agentClient";

export class CpuAgentClient implements IAgentClient {
  readonly type = AgentType.CPU;
  readonly usesLiveApi = false;

  private lastChatTime = 0;

  async decideShot(obs: AirHockeyObservation): Promise<AgentTelemetry> {
    const started = performance.now();
    const { config, side, puckPos, puckVel } = obs;

    // 自陣内に引いた迎撃ライン。ゴールから離しすぎると裏を取られる
    const interceptLineY = side === "TOP" ? config.height * 0.22 : config.height * 0.78;
    const crossing = predictCrossing(puckPos, puckVel, interceptLineY, config);

    const interceptPoint = crossing
      ? crossing.point
      : // 予測が取れない場合はゴール前中央で待つ
        new Vec2(config.width * 0.5, interceptLineY);

    // 相手マレットの逆サイドを狙う
    const goal = opponentGoalCenter(side, config);
    const opponentOffset = obs.opponentMalletPos.x - config.width * 0.5;
    const aimX = goal.x + (opponentOffset > 0 ? -config.goalWidth * 0.35 : config.goalWidth * 0.35);
    const aimPoint = new Vec2(aimX, goal.y);

    // 迎撃点から狙い点へ向かう方向へ振り抜く
    const swing = aimPoint.sub(interceptPoint);
    const swingDirDeg = (Math.atan2(swing.y, swing.x) * 180) / Math.PI;

    const result = validateShotPlan(
      {
        interceptPoint: { x: interceptPoint.x, y: interceptPoint.y },
        aimPoint: { x: aimPoint.x, y: aimPoint.y },
        swingDirDeg,
        swingSpeed: config.maxMalletSpeed,
        comment: this.pickChat(),
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

  private pickChat(): string | undefined {
    const now = performance.now();
    if (now - this.lastChatTime < 5000) return undefined;
    this.lastChatTime = now;

    const lines = [
      "[CPU] 軌道ベクトル解析完了。迎撃点を算出しました。",
      "[CPU] 反射角を計算中。相手マレットの逆サイドを狙います。",
      "[CPU] 幾何解ソルバー実行中。最短経路で迎撃します。",
      "[CPU] 壁反射を折り込んだ着弾予測を更新しました。",
    ];
    return lines[Math.floor(Math.random() * lines.length)];
  }

  private buildChat(comment: string | undefined): MindGameChat | null {
    if (!comment) return null;
    return { text: comment, category: "CALCULATE", timestamp: Date.now() };
  }
}
