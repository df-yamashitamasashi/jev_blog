/**
 * Agent Servo Controller (Clean Architecture - UseCases Layer)
 *
 * このクラスは戦術判断を一切行わない。エージェントが返した ShotPlan を
 * 物理的な制約 (最大速度・最大加速度・自陣の範囲) の中で忠実に実行するだけの
 * サーボ機構であり、「どこで待ち受け、どちらへ振り抜くか」は完全にAI側の責任。
 */

import { Vec2, CircleBody } from "../domain/physics";
import { AgentTelemetry, AgentType, ShotPlan } from "../domain/jevAgentTypes";
import { StadiumConfig } from "../domain/gameState";
import { PlaySide, malletYRange } from "../domain/shotPlanValidator";
import { IAgentClient, AirHockeyObservation } from "../adapters/agentClient";

/** スイングに移行するパックとの距離の余裕 (px) */
const SWING_TRIGGER_MARGIN = 46;

export class AgentBrainUseCase {
  private client: IAgentClient | null;
  private readonly config: StadiumConfig;
  private readonly side: PlaySide;
  private agentType: AgentType;

  private telemetry: AgentTelemetry | null = null;
  private plan: ShotPlan | null = null;
  private awaitingDecision = false;
  private decisionArmed = true;
  private lastApproaching = false;
  private touchedThisApproach = false;

  constructor(
    client: IAgentClient | null,
    config: StadiumConfig,
    side: PlaySide = "TOP",
    agentType: AgentType = AgentType.CPU
  ) {
    this.client = client;
    this.config = config;
    this.side = side;
    this.agentType = agentType;
  }

  setClient(client: IAgentClient | null, type: AgentType): void {
    this.client = client;
    this.agentType = type;
    this.reset();
  }

  getAgentType(): AgentType {
    return this.agentType;
  }

  getSide(): PlaySide {
    return this.side;
  }

  getTelemetry(): AgentTelemetry | null {
    return this.telemetry;
  }

  getPlan(): ShotPlan | null {
    return this.plan;
  }

  isAwaitingDecision(): boolean {
    return this.awaitingDecision;
  }

  /** 人間操作の場合は制御しない */
  isControlled(): boolean {
    return this.client !== null;
  }

  reset(): void {
    this.telemetry = null;
    this.plan = null;
    this.awaitingDecision = false;
    this.decisionArmed = true;
    this.lastApproaching = false;
    this.touchedThisApproach = false;
  }

  /** 物理エンジンの衝突コールバックから呼ぶ */
  recordContact(): void {
    this.touchedThisApproach = true;
  }

  /** この接近局面でパックに触れられたか (空振り判定用) */
  hasTouchedThisApproach(): boolean {
    return this.touchedThisApproach;
  }

  private isApproaching(puck: CircleBody): boolean {
    return this.side === "TOP" ? puck.vel.y < -20 : puck.vel.y > 20;
  }

  /**
   * パックの状態を観測し、判断の要否と接近局面の終了を報告する。
   * 「こちらへ向かってきた一連の流れ」を1局面として数え、その間に触れたかで
   * セーブと空振りを判定する。
   */
  observe(puck: CircleBody): { needsDecision: boolean; approachEnded: "SAVE" | "WHIFF" | null } {
    if (!this.client) return { needsDecision: false, approachEnded: null };

    const approaching = this.isApproaching(puck);
    let approachEnded: "SAVE" | "WHIFF" | null = null;

    if (approaching && !this.lastApproaching) {
      this.decisionArmed = true;
      this.touchedThisApproach = false;
    } else if (!approaching && this.lastApproaching) {
      approachEnded = this.touchedThisApproach ? "SAVE" : "WHIFF";
    }
    this.lastApproaching = approaching;

    return {
      needsDecision: !this.awaitingDecision && this.decisionArmed && approaching,
      approachEnded,
    };
  }

  /** ゴールを許した時点で、その局面は空振りとして確定させる */
  finalizeApproach(): "SAVE" | "WHIFF" | null {
    if (!this.client || !this.lastApproaching) return null;
    this.lastApproaching = false;
    return this.touchedThisApproach ? "SAVE" : "WHIFF";
  }

  /**
   * エージェントへ判断を要求する。
   * 呼び出し側は解決を待つ間シミュレーション時間を進めないこと。
   */
  async requestDecision(
    puck: CircleBody,
    myMallet: CircleBody,
    opponentMallet: CircleBody,
    myScore: number,
    opponentScore: number
  ): Promise<AgentTelemetry | null> {
    if (!this.client) return null;

    this.awaitingDecision = true;
    this.decisionArmed = false;

    const observation: AirHockeyObservation = {
      side: this.side,
      puckPos: puck.pos.clone(),
      puckVel: puck.vel.clone(),
      myMalletPos: myMallet.pos.clone(),
      myMalletVel: myMallet.vel.clone(),
      opponentMalletPos: opponentMallet.pos.clone(),
      opponentMalletVel: opponentMallet.vel.clone(),
      myScore,
      opponentScore,
      config: this.config,
    };

    try {
      const telemetry = await this.client.decideShot(observation);
      this.telemetry = telemetry;
      // 無効な判断はローカルで救済しない。計画なし = そのまま空振りする
      this.plan = telemetry.plan;
      return telemetry;
    } finally {
      this.awaitingDecision = false;
    }
  }

  /**
   * 1ステップ分マレットを動かす。戦術判断はここには一切存在しない。
   */
  stepServo(dt: number, myMallet: CircleBody, puck: CircleBody): void {
    if (!this.client) return;

    const desired = this.desiredVelocity(myMallet, puck);
    this.applyAcceleration(dt, myMallet, desired);
    this.integrateAndConstrain(dt, myMallet);
  }

  /** 計画が無ければ自陣ゴール前で待機する (何もしないと確実に失点するため) */
  private desiredVelocity(myMallet: CircleBody, puck: CircleBody): Vec2 {
    const { maxMalletSpeed } = this.config;

    if (!this.plan) return new Vec2(0, 0);

    const contactDist = this.config.puckRadius + this.config.malletRadius + SWING_TRIGGER_MARGIN;
    const nearIntercept = myMallet.pos.dist(this.plan.interceptPoint) < contactDist;
    const puckInRange = puck.pos.dist(this.plan.interceptPoint) < contactDist;

    // スイング局面: 指定された方向へ指定された速度で振り抜く
    if (nearIntercept && puckInRange) {
      const rad = (this.plan.swingDirDeg * Math.PI) / 180;
      return new Vec2(Math.cos(rad), Math.sin(rad)).scale(this.plan.swingSpeed);
    }

    // 移動局面: 迎撃点へ向かう
    const toTarget = this.plan.interceptPoint.sub(myMallet.pos);
    const dist = toTarget.mag();
    if (dist < 0.5) return new Vec2(0, 0);

    return toTarget.normalize().scale(Math.min(maxMalletSpeed, dist / this.config.fixedDt));
  }

  /** 最大加速度の制約下で目標速度へ近づける (瞬間的なワープを禁止) */
  private applyAcceleration(dt: number, myMallet: CircleBody, desired: Vec2): void {
    const { maxMalletAccel, maxMalletSpeed } = this.config;

    const deltaV = desired.sub(myMallet.vel);
    const maxDelta = maxMalletAccel * dt;
    const applied = deltaV.mag() > maxDelta ? deltaV.normalize().scale(maxDelta) : deltaV;

    let next = myMallet.vel.add(applied);
    const speed = next.mag();
    if (speed > maxMalletSpeed) {
      next = next.scale(maxMalletSpeed / speed);
    }
    myMallet.vel = next;
  }

  private integrateAndConstrain(dt: number, myMallet: CircleBody): void {
    myMallet.pos = myMallet.pos.add(myMallet.vel.scale(dt));

    const margin = this.config.malletRadius;
    const [minY, maxY] = malletYRange(this.side, this.config);

    if (myMallet.pos.x < margin) {
      myMallet.pos.x = margin;
      myMallet.vel.x = 0;
    } else if (myMallet.pos.x > this.config.width - margin) {
      myMallet.pos.x = this.config.width - margin;
      myMallet.vel.x = 0;
    }

    if (myMallet.pos.y < minY) {
      myMallet.pos.y = minY;
      myMallet.vel.y = 0;
    } else if (myMallet.pos.y > maxY) {
      myMallet.pos.y = maxY;
      myMallet.vel.y = 0;
    }
  }
}
