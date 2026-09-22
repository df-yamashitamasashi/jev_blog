/**
 * Agent Client Contract (Clean Architecture - Adapter Layer)
 *
 * 全エージェント (CPU / Jev / Gemini / Claude) が実装する唯一の意思決定インターフェース。
 * 座標は反転正規化せず、常にコートの実座標で渡す。自陣がどちらかは side で伝える。
 */

import { Vec2 } from "../domain/physics";
import { StadiumConfig } from "../domain/gameState";
import { AgentTelemetry, AgentType } from "../domain/jevAgentTypes";
import { PlaySide } from "../domain/shotPlanValidator";

/** エージェントに渡す完全な盤面情報 */
export interface AirHockeyObservation {
  side: PlaySide;
  puckPos: Vec2;
  puckVel: Vec2;
  myMalletPos: Vec2;
  myMalletVel: Vec2;
  opponentMalletPos: Vec2;
  opponentMalletVel: Vec2;
  myScore: number;
  opponentScore: number;
  config: StadiumConfig;
}

export interface IAgentClient {
  readonly type: AgentType;
  /** 実際にクラウドAPIへ問い合わせるか (CPUのみ false) */
  readonly usesLiveApi: boolean;
  decideShot(obs: AirHockeyObservation): Promise<AgentTelemetry>;
}

/** 自陣ゴールの中心 (守るべき場所) */
export function ownGoalCenter(side: PlaySide, config: StadiumConfig): Vec2 {
  return new Vec2(config.width * 0.5, side === "TOP" ? 0 : config.height);
}

/** 相手ゴールの中心 (狙うべき場所) */
export function opponentGoalCenter(side: PlaySide, config: StadiumConfig): Vec2 {
  return new Vec2(config.width * 0.5, side === "TOP" ? config.height : 0);
}

/**
 * 壁反射を含めたパックの軌道予測。指定した Y ラインを横切る点を返す。
 * 横切らない場合は null。
 */
export function predictCrossing(
  puckPos: Vec2,
  puckVel: Vec2,
  lineY: number,
  config: StadiumConfig,
  maxSeconds: number = 3.0
): { point: Vec2; timeSec: number } | null {
  const dt = 1 / 240;
  const steps = Math.floor(maxSeconds / dt);
  const decayPerStep = Math.pow(config.puckFriction, dt);

  let pos = puckPos.clone();
  let vel = puckVel.clone();
  const left = config.puckRadius;
  const right = config.width - config.puckRadius;

  for (let i = 0; i < steps; i++) {
    vel = vel.scale(decayPerStep);
    const next = pos.add(vel.scale(dt));

    if (next.x <= left) {
      next.x = left + (left - next.x);
      vel.x = -vel.x * config.wallRestitution;
    } else if (next.x >= right) {
      next.x = right - (next.x - right);
      vel.x = -vel.x * config.wallRestitution;
    }

    // Yラインを跨いだか (方向を問わず)
    if ((pos.y - lineY) * (next.y - lineY) <= 0 && pos.y !== next.y) {
      const t = (lineY - pos.y) / (next.y - pos.y);
      return {
        point: new Vec2(pos.x + (next.x - pos.x) * t, lineY),
        timeSec: (i + t) * dt,
      };
    }

    pos = next;
  }

  return null;
}
