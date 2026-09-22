/**
 * Cyberpunk Stadium Canvas Renderer (Clean Architecture - Presentation Layer)
 * ネオングロー、残像トレイル、火花パーティクル、Jev視界レーザー描画
 */

import { Vec2, CircleBody } from "../domain/physics";
import { StadiumConfig } from "../domain/gameState";
import { AgentTelemetry, AgentType, AGENT_PROFILES } from "../domain/jevAgentTypes";

interface SparkParticle {
  pos: Vec2;
  vel: Vec2;
  color: string;
  size: number;
  life: number;
  maxLife: number;
}

export class CanvasRenderer {
  private ctx: CanvasRenderingContext2D;
  private readonly config: StadiumConfig;
  private puckTrail: Vec2[] = [];
  private particles: SparkParticle[] = [];
  private shakeTime: number = 0;
  private shakeMagnitude: number = 0;

  constructor(canvas: HTMLCanvasElement, config: StadiumConfig) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not get 2D rendering context");
    this.ctx = context;
    this.config = config;

    canvas.width = config.width;
    canvas.height = config.height;
  }

  triggerShake(magnitude: number = 6, durationSec: number = 0.15): void {
    this.shakeMagnitude = magnitude;
    this.shakeTime = durationSec;
  }

  addSparks(pos: Vec2, count: number = 18, color: string = "#00f0ff"): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 120 + Math.random() * 380;
      this.particles.push({
        pos: pos.clone(),
        vel: new Vec2(Math.cos(angle) * speed, Math.sin(angle) * speed),
        color,
        size: 1.5 + Math.random() * 3,
        life: 0,
        maxLife: 0.25 + Math.random() * 0.35,
      });
    }
  }

  render(
    dt: number,
    puck: CircleBody,
    playerMallet: CircleBody,
    jevMallet: CircleBody,
    topTelemetry: AgentTelemetry | null,
    bottomTelemetry: AgentTelemetry | null = null,
    topAgent: AgentType = AgentType.JEV,
    bottomAgent: AgentType = AgentType.HUMAN
  ): void {
    const { width, height } = this.config;
    const ctx = this.ctx;

    // 画面シェイク処理
    ctx.save();
    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      const ox = (Math.random() - 0.5) * this.shakeMagnitude;
      const oy = (Math.random() - 0.5) * this.shakeMagnitude;
      ctx.translate(ox, oy);
    }

    const isTopLiveAi = !!topTelemetry?.isLiveApi;
    const isBotHuman = bottomAgent === AgentType.HUMAN;
    const isBotLiveAi = !isBotHuman && !!bottomTelemetry?.isLiveApi;

    // 1. 背景クリア & サイバーグリッド & 稼働モードウォーターマーク
    this.renderCourtBackground(width, height, topAgent, bottomAgent, isTopLiveAi, isBotLiveAi, isBotHuman);

    // 2. 各AIが「宣言した意図」を描画する (ローカル予測ではなくAI自身の判断)
    if (topTelemetry) {
      this.renderAgentIntent(topTelemetry, AGENT_PROFILES[topAgent].primaryColor);
    }
    if (bottomTelemetry) {
      this.renderAgentIntent(bottomTelemetry, AGENT_PROFILES[bottomAgent].primaryColor);
    }

    // 3. パック残像トレイル
    this.renderPuckTrail(puck);

    // 4. パーティクル更新 & 描画
    this.renderParticles(dt);

    // 5. パック本体描画 (ネオンホワイト)
    this.renderPuck(puck);

    // 6. マレット描画 (Top & Bottom: 動作モードバッジ付き)
    const topProf = AGENT_PROFILES[topAgent];
    const botProf = AGENT_PROFILES[bottomAgent];
    this.renderMallet(
      jevMallet,
      topProf.primaryColor,
      topProf.secondaryColor,
      topProf.displayName,
      false, // isHuman
      isTopLiveAi
    );
    this.renderMallet(
      playerMallet,
      botProf.primaryColor,
      botProf.secondaryColor,
      botProf.displayName,
      isBotHuman,
      isBotLiveAi
    );

    ctx.restore();
  }

  private renderCourtBackground(
    width: number,
    height: number,
    topAgent: AgentType = AgentType.JEV,
    bottomAgent: AgentType = AgentType.HUMAN,
    isTopLiveAi: boolean = false,
    isBotLiveAi: boolean = false,
    isBotHuman: boolean = true
  ): void {
    const ctx = this.ctx;

    // ダークサイバーグラデーション
    const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
    bgGrad.addColorStop(0, "#080b18");
    bgGrad.addColorStop(0.5, "#0d1326");
    bgGrad.addColorStop(1, "#080b18");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    // コート上での動作モード刻印 (ウォーターマーク)
    ctx.font = "bold 10px 'JetBrains Mono', monospace";
    ctx.textAlign = "center";
    
    // Topゾーン表示
    ctx.fillStyle = isTopLiveAi ? "rgba(52, 211, 153, 0.22)" : "rgba(251, 191, 36, 0.22)";
    const topZoneText = `[ ${topAgent} ZONE : ${isTopLiveAi ? "🟢 LIVE CLOUD AI" : "🖥️ CPU SIMULATOR"} ]`;
    ctx.fillText(topZoneText, width * 0.5, 65);

    // Bottomゾーン表示
    ctx.fillStyle = isBotHuman
      ? "rgba(0, 240, 255, 0.22)"
      : isBotLiveAi
      ? "rgba(52, 211, 153, 0.22)"
      : "rgba(251, 191, 36, 0.22)";
    const botZoneText = isBotHuman
      ? "[ PLAYER ZONE : 👤 HUMAN CONTROL ]"
      : `[ ${bottomAgent} ZONE : ${isBotLiveAi ? "🟢 LIVE CLOUD AI" : "🖥️ CPU SIMULATOR"} ]`;
    ctx.fillText(botZoneText, width * 0.5, height - 55);

    // グリッドライン
    ctx.strokeStyle = "rgba(0, 240, 255, 0.04)";
    ctx.lineWidth = 1;
    const gridSize = 40;
    for (let x = 0; x < width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // 外枠ネオン境界線
    ctx.strokeStyle = "rgba(0, 240, 255, 0.4)";
    ctx.lineWidth = 4;
    ctx.shadowColor = "#00f0ff";
    ctx.shadowBlur = 12;
    ctx.strokeRect(4, 4, width - 8, height - 8);
    ctx.shadowBlur = 0;

    // センターライン
    ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.moveTo(0, height * 0.5);
    ctx.lineTo(width, height * 0.5);
    ctx.stroke();
    ctx.setLineDash([]);

    // センターサークル
    ctx.strokeStyle = "rgba(0, 240, 255, 0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(width * 0.5, height * 0.5, 70, 0, Math.PI * 2);
    ctx.stroke();

    // ゴールポスト描画
    this.renderGoalAreas(width, height);
  }

  private renderGoalAreas(width: number, height: number): void {
    const ctx = this.ctx;
    const goalW = this.config.goalWidth;
    const goalLeft = (width - goalW) * 0.5;

    // Jev ゴール (上部マゼンタ)
    ctx.fillStyle = "rgba(255, 0, 85, 0.15)";
    ctx.fillRect(goalLeft, 0, goalW, 30);
    ctx.strokeStyle = "#ff0055";
    ctx.lineWidth = 4;
    ctx.shadowColor = "#ff0055";
    ctx.shadowBlur = 14;
    ctx.strokeRect(goalLeft, 0, goalW, 10);

    // Player ゴール (下部シアン)
    ctx.fillStyle = "rgba(0, 240, 255, 0.15)";
    ctx.fillRect(goalLeft, height - 30, goalW, 30);
    ctx.strokeStyle = "#00f0ff";
    ctx.lineWidth = 4;
    ctx.shadowColor = "#00f0ff";
    ctx.shadowBlur = 14;
    ctx.strokeRect(goalLeft, height - 10, goalW, 10);

    ctx.shadowBlur = 0;
  }

  /**
   * AIが宣言した意図を可視化する。
   * ローカルで計算した予測ではなく、エージェント自身が返した迎撃点・振り抜き方向・
   * 狙い点をそのまま描くので、判断の良し悪しが画面から読み取れる。
   */
  private renderAgentIntent(telemetry: AgentTelemetry, laserColor: string): void {
    const ctx = this.ctx;
    const { plan } = telemetry;
    if (!plan) return;

    const { interceptPoint, aimPoint, swingDirDeg, swingSpeed } = plan;

    // 1. 狙い点へのライン (どこへ飛ばそうとしているか)
    ctx.strokeStyle = laserColor;
    ctx.globalAlpha = 0.28;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(interceptPoint.x, interceptPoint.y);
    ctx.lineTo(aimPoint.x, aimPoint.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // 2. 迎撃点のレティクル
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(interceptPoint.x, interceptPoint.y, 16, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(interceptPoint.x - 22, interceptPoint.y);
    ctx.lineTo(interceptPoint.x + 22, interceptPoint.y);
    ctx.moveTo(interceptPoint.x, interceptPoint.y - 22);
    ctx.lineTo(interceptPoint.x, interceptPoint.y + 22);
    ctx.stroke();

    // 3. スイングベクトル (方向と強さ)
    const rad = (swingDirDeg * Math.PI) / 180;
    const length = 26 + (swingSpeed / 900) * 44;
    const tipX = interceptPoint.x + Math.cos(rad) * length;
    const tipY = interceptPoint.y + Math.sin(rad) * length;

    ctx.globalAlpha = 0.95;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(interceptPoint.x, interceptPoint.y);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();

    ctx.fillStyle = laserColor;
    ctx.beginPath();
    ctx.arc(tipX, tipY, 4.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 1.0;
  }

  private renderPuckTrail(puck: CircleBody): void {
    this.puckTrail.unshift(puck.pos.clone());
    if (this.puckTrail.length > 12) this.puckTrail.pop();

    const ctx = this.ctx;
    for (let i = 0; i < this.puckTrail.length; i++) {
      const p = this.puckTrail[i];
      const alpha = (1 - i / this.puckTrail.length) * 0.35;
      const size = puck.radius * (1 - (i / this.puckTrail.length) * 0.4);

      ctx.fillStyle = `rgba(0, 240, 255, ${alpha})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private renderPuck(puck: CircleBody): void {
    const ctx = this.ctx;

    // パック外周グロー
    ctx.shadowColor = "#00f0ff";
    ctx.shadowBlur = 18;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(puck.pos.x, puck.pos.y, puck.radius, 0, Math.PI * 2);
    ctx.fill();

    // パック内側のコアパターン
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#00f0ff";
    ctx.beginPath();
    ctx.arc(puck.pos.x, puck.pos.y, puck.radius * 0.55, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#080b18";
    ctx.beginPath();
    ctx.arc(puck.pos.x, puck.pos.y, puck.radius * 0.25, 0, Math.PI * 2);
    ctx.fill();
  }

  private renderMallet(
    mallet: CircleBody,
    primaryColor: string,
    secondaryColor: string,
    displayName: string,
    isHuman: boolean,
    isLiveAi: boolean
  ): void {
    const ctx = this.ctx;

    // 外枠リング & グロー
    ctx.shadowColor = primaryColor;
    ctx.shadowBlur = 18;
    ctx.strokeStyle = primaryColor;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(mallet.pos.x, mallet.pos.y, mallet.radius, 0, Math.PI * 2);
    ctx.stroke();

    // 本体グラデーション
    const grad = ctx.createRadialGradient(
      mallet.pos.x - 6,
      mallet.pos.y - 6,
      2,
      mallet.pos.x,
      mallet.pos.y,
      mallet.radius
    );
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(0.4, primaryColor);
    grad.addColorStop(1, secondaryColor);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(mallet.pos.x, mallet.pos.y, mallet.radius - 3, 0, Math.PI * 2);
    ctx.fill();

    // 中央グリップノブ
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#0a0e1e";
    ctx.beginPath();
    ctx.arc(mallet.pos.x, mallet.pos.y, mallet.radius * 0.42, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = primaryColor;
    ctx.beginPath();
    ctx.arc(mallet.pos.x, mallet.pos.y, mallet.radius * 0.2, 0, Math.PI * 2);
    ctx.fill();

    // 1. エージェント名
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 11px 'Outfit', sans-serif";
    ctx.textAlign = "center";
    const nameY = isHuman ? mallet.pos.y + 42 : mallet.pos.y - 34;
    ctx.fillText(displayName, mallet.pos.x, nameY);

    // 2. 動作モードバッジ (AI vs CPU vs HUMAN)
    const tagText = isHuman
      ? "👤 HUMAN"
      : isLiveAi
      ? "🟢 本物AI (Cloud)"
      : "🖥️ CPU (Simulator)";

    const tagColor = isHuman ? "#00f0ff" : isLiveAi ? "#34d399" : "#fbbf24";
    const tagBg = isHuman
      ? "rgba(0, 240, 255, 0.25)"
      : isLiveAi
      ? "rgba(16, 185, 129, 0.28)"
      : "rgba(217, 119, 6, 0.28)";
    const tagBorder = isHuman
      ? "rgba(0, 240, 255, 0.6)"
      : isLiveAi
      ? "rgba(16, 185, 129, 0.7)"
      : "rgba(217, 119, 6, 0.6)";

    ctx.font = "bold 9px 'JetBrains Mono', monospace";
    const textWidth = ctx.measureText(tagText).width;
    const badgeW = textWidth + 12;
    const badgeH = 16;
    const badgeY = isHuman ? mallet.pos.y + 48 : mallet.pos.y - 56;
    const badgeX = mallet.pos.x - badgeW / 2;

    ctx.fillStyle = tagBg;
    ctx.strokeStyle = tagBorder;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 4);
    } else {
      ctx.rect(badgeX, badgeY, badgeW, badgeH);
    }
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = tagColor;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(tagText, mallet.pos.x, badgeY + badgeH / 2);
    ctx.textBaseline = "alphabetic"; // reset
  }

  private renderParticles(dt: number): void {
    const ctx = this.ctx;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.particles.splice(i, 1);
        continue;
      }

      p.pos = p.pos.add(p.vel.scale(dt));
      p.vel = p.vel.scale(0.96);

      const alpha = 1 - p.life / p.maxLife;
      ctx.fillStyle = p.color;
      ctx.globalAlpha = alpha;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(p.pos.x, p.pos.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1.0;
    ctx.shadowBlur = 0;
  }
}
