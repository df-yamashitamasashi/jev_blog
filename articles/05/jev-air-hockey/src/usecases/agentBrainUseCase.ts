/**
 * Agent Servo Controller (Clean Architecture - UseCases Layer)
 *
 * このクラスは戦術判断を一切行わない。エージェントが返した ShotPlan を、
 * 物理的な制約 (最大速度・最大加速度・自陣の範囲) の中でそのまま実行するための
 * サーボ機構である。
 *
 * 判断のタイミング:
 *   パックが中央線を越えて自陣へ入ってきた瞬間の **1回だけ** (CPU も LLM も同じ)。
 *   そこでエージェントは軌道を予測し、「いつ・どこで・どの向きに・どれだけ強く打つか」
 *   「直線か曲線か・どの速さで構え位置へ向かうか」「来た球を打つか跳ね返りを打つか」
 *   をまとめて決める。
 *
 * 実行は開ループ:
 *   サーボはパックを見て打点を補正しない。予告された時刻に予告された位置を振り抜く
 *   だけなので、予測を外せばそのまま空振りになる。1回の判断の精度が勝敗を決める。
 *
 * 作戦 (試合前の作戦タイムにエージェント自身が決めたもの。[[playbook]]):
 *   - 中央線での判断が通信失敗・時間切れ・応答不正で得られなければ、その局面の作戦で打つ
 *   - パックが自陣に2秒以上留まれば (判断の機会が無い)、居座る球の作戦で打つ
 *
 * 作戦はあるが、その局面に当てはまる手が無い (欠けている・当てはめられない) とき:
 *   CPU に任せる (CPU代行)。次に中央線を越えてくるまで、その局面は CPU の判断と反射で動く。
 *   回数は記録し、HUD とトーナメント表に出す。
 *
 * 計画も作戦も無いとき:
 *   クラウドAI — NO_PLAN。作戦で決めた待機位置で待つだけで、ローカル演算では一切プレーしない
 *                (時間切れ・通信失敗の局面を CPU が肩代わりすると、AI対戦にならない)
 *   CPU        — CPU 自身がローカル演算のエージェントなので、反射で動く
 *     DEFEND  — 速い球の進路へ体を入れる
 *     CLEANUP — 自陣でゴールに向かっていない球 (遅い球・壁沿いの往復) を必ず打ちに行く
 *     HOME    — パックが相手陣にある
 */

import { Vec2, CircleBody } from "../domain/physics";
import { AgentTelemetry, AgentType, ShotPlan } from "../domain/jevAgentTypes";
import { StadiumConfig } from "../domain/gameState";
import { PlaySide } from "../domain/shotPlanValidator";
import { IAgentClient, AirHockeyObservation, PlaybookContext, PlaybookTelemetry } from "../adapters/agentClient";
import {
  Playbook,
  LINGER_THRESHOLD_SEC,
  classifyIncoming,
  classifyLingering,
  moveToPlan,
} from "../domain/playbook";
import { PuckTrajectory, predictPuckPath, sampleAt } from "../domain/puckPredictor";
import { bezierLength, bezierPoint, curveControlPoint } from "../domain/approachPath";
import {
  InterceptSolution,
  MalletLimits,
  limitsFor,
  solveBlockPoint,
  solveIntercept,
  travelTime,
} from "../domain/interception";

/**
 * 中央線を越えたと判定する幅 (px)。1ステップで進む距離 (最高速 2000px/s で約17px) より
 * 広くとる。これより奥で初めて見つかったパック (サーブ直後など) は中央線での判断にしない。
 */
const CENTER_LINE_BAND_PX = 40;

/** 作戦タイムで作戦を作り直させる最大回数 (初回を含む) */
const PLAYBOOK_MAX_ATTEMPTS = 3;

/**
 * CLEANUP で掻き出す対象にする速度の上限 (px/s)。
 * これより速い球でも、自陣ゴールへ向かっていなければ (壁沿いの往復など) 掻き出しに行く。
 */
const CLEANUP_MAX_PUCK_SPEED = 450;

/** 打点が立たない球を追いかけるとき、何秒先のパック位置へ向かうか */
const CHASE_LEAD_SEC = 0.25;

/** 経路をなぞるときの先読み距離 (px) */
const PATH_LOOKAHEAD_PX = 36;

/** 軌道予測を作り直す間隔 (物理ステップ数)。毎ステップ作っても結果はほぼ変わらない */
const PREDICT_EVERY_STEPS = 3;

/** 予測の地平線 (秒)。長すぎると相手が触った後の無意味な未来まで数えてしまう */
const PREDICT_HORIZON_SEC = 2.0;

/** これ以上先の迎撃はまだ「待ち」。近づいてから解き直した方が精度が高い */
const STRIKE_HORIZON_SEC = 1.4;

/** 間に合わないと分かっていても、この程度の遅れなら全力で取りに行く */
const DESPERATE_SLACK_SEC = -0.32;

/** 振りかぶりの最大距離 (px)。これ以上下がるとゴールを空ける */
const MAX_WINDUP_PX = 150;

/** 迎撃解に要求する、助走のための追加余裕 (秒) */
const SETUP_MARGIN_SEC = 0.04;

/** 一度当てた直後、パックが離れるまで再コミットを控えるステップ数 */
const CONTACT_COOLDOWN_STEPS = 8;

/** スイング軸方向のズレを詰める比例ゲイン (1/s) */
const TRACKING_GAIN = 14;

/** スイング軸に直交するズレを詰める比例ゲイン (1/s)。狙いの精度を直接決める */
const LATERAL_TRACKING_GAIN = 36;

/** 接触予定時刻を過ぎてもこの秒数は振り抜き続ける */
const COMMITMENT_GRACE_SEC = 0.12;

/** 固定した接触地点からパック予測がこれだけずれたら解き直す (px) */
const COMMITMENT_DRIFT_PX = 26;

/** 振りかぶりから打撃へ切り替える余裕 (秒) */
const STRIKE_LEAD_SEC = 0.03;

/** 回り込むときにパックから空ける余白 (px) */
const PUCK_CLEARANCE_PX = 26;

/** この距離まで近づいたら自殺点ガードを働かせる (px) */
const CONTACT_GUARD_PX = 14;

/** 接触法線が自陣ゴールをどれだけ向いていたら危険とみなすか (法線のy成分) */
const OWN_GOAL_PUSH_TOLERANCE = 0.2;

/** 向き直りに必要な時間へ掛ける安全率 */
const ALIGN_SAFETY_FACTOR = 0.9;

/** 相手の打球を検知する速度変化のしきい値 (px/s) */
const OPPONENT_HIT_DELTA = 140;

export type ServoMode = "SETUP" | "STRIKE" | "DEFEND" | "CLEANUP" | "HOME" | "NO_PLAN";

/** HUD 描画用: いま実行中の計画の経路 */
export interface PlannedPath {
  start: Vec2;
  control: Vec2;
  windupPoint: Vec2;
  contactPoint: Vec2;
  /** 接触の瞬間にパックが居るはずの位置 (= エージェントの予測) */
  expectedPuckPos: Vec2;
}

/**
 * 実行中の一撃。振り始めたら接触予定時刻を固定し、自前の時計で追い込む。
 *
 * 毎ステップ解き直した接触時刻をそのまま使うと、解が更新されるたびに残り時間が
 * リセットされ、加速プロファイル上の経過時間がいつまでも 0 付近に留まる。
 * 結果としてマレットは振りかぶり点の周りで固まり、パックに押し負ける。
 */
interface StrikeCommitment {
  /** AGENT = エージェントの計画・作戦 (開ループ) / LOCAL = CPU の CLEANUP の反射 */
  source: "AGENT" | "LOCAL";
  /** LIVE = 中央線での判断 / PLAYBOOK = 作戦タイムに決めた作戦 / CPU = CPU代行 */
  origin: "LIVE" | "PLAYBOOK" | "CPU";
  contactPoint: Vec2;
  /** 振りかぶって待つ位置 */
  windupPoint: Vec2;
  swingDir: Vec2;
  swingSpeed: number;
  /** 接触までの残り時間 (秒)。毎ステップ dt だけ減らす */
  timeLeft: number;
  /** 助走距離と、そこを走り切るのに必要な時間 */
  runUp: number;
  swingTime: number;
  /** 接触の瞬間にパックが居るはずの位置 */
  expectedPuckPos: Vec2;
  /** すでに振り始めたか。振り始めるまではパックに触れない */
  launched: boolean;
  /** 構え位置までの経路 (2次ベジェ。直線なら制御点は中点) */
  pathStart: Vec2;
  pathControl: Vec2;
  pathLength: number;
  /** 経路上の進み具合 (0..1) */
  pathS: number;
  moveSpeed: number;
  /** 予測誤差をすでに記録したか */
  predictionScored: boolean;
}

export class AgentBrainUseCase {
  private client: IAgentClient | null;
  private readonly config: StadiumConfig;
  private readonly side: PlaySide;
  private readonly limits: MalletLimits;
  private agentType: AgentType;

  private telemetry: AgentTelemetry | null = null;
  private plan: ShotPlan | null = null;
  private awaitingDecision = false;
  /** パックが相手陣に出たら立つ。中央線を越えて戻ってきた瞬間に判断して倒す */
  private centerLineArmed = true;
  private lastEngaged = false;
  private touchedThisApproach = false;
  private apiCooldownUntil = 0;
  /** 判断を要求してから経過したシミュレーション時間 (ms)。応答遅延ぶんを計画から差し引く */
  private msSinceDecision = Number.POSITIVE_INFINITY;
  private predictionErrors: number[] = [];

  /** 作戦タイムに決めた作戦。試合中は変わらない (reset でも消さない) */
  private playbook: Playbook | null = null;
  private playbookTelemetry: PlaybookTelemetry | null = null;
  /** パックが自陣に居続けている時間 (秒)。中央線を越えると 0 に戻る */
  private ownHalfSec = 0;
  /** いま実行している作戦の局面 (HUD表示用) */
  private activeSituation: string | null = null;
  /** 作戦に当てはまる手が無かった局面を任せる CPU */
  private takeoverClient: IAgentClient | null = null;
  /** いま CPU代行 中か。次に中央線を越えてくるまで続く */
  private cpuTakeover = false;
  /** まだゲームループへ報告していない CPU代行の回数 */
  private takeoverEvents = 0;
  /** 作戦の狙い (相手マレットから遠い側など) を決めるための、相手マレットの位置 */
  private opponentMalletPos: Vec2 = new Vec2(0, 0);

  private trajectory: PuckTrajectory | null = null;
  private stepsSincePredict = Number.POSITIVE_INFINITY;
  private lastPuckVel = new Vec2(0, 0);
  private mode: ServoMode = "HOME";
  private solution: InterceptSolution | null = null;
  /** 実行中の一撃。null ならまだ振っていない (= パックへの接触を許さない) */
  private commitment: StrikeCommitment | null = null;
  private contactCooldownSteps = 0;

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
    this.limits = limitsFor(side, config);
  }

  setClient(client: IAgentClient | null, type: AgentType): void {
    this.client = client;
    this.agentType = type;
    // エージェントが替わったら、前のエージェントの作戦は使えない
    this.playbook = null;
    this.playbookTelemetry = null;
    this.reset();
  }

  /**
   * 作戦タイム。エージェントに作戦を立てさせる。
   *
   * ガードレール: 抜け漏れ・不正のある作戦は受け付けず、どこが不合格だったかを
   * 伝えて作り直させる (最大 PLAYBOOK_MAX_ATTEMPTS 回)。時間切れは作り直しても
   * 同じ結果になりやすいので繰り返さない。最後まで揃わなければ作戦なし
   * (呼び出し側は試合を始めない)。
   */
  async preparePlaybook(ctx: PlaybookContext): Promise<PlaybookTelemetry | null> {
    this.playbook = null;
    this.playbookTelemetry = null;
    if (!this.client?.decidePlaybook) return null;

    let telemetry: PlaybookTelemetry | null = null;
    for (let attempt = 1; attempt <= PLAYBOOK_MAX_ATTEMPTS; attempt++) {
      telemetry = await this.client.decidePlaybook(
        attempt === 1 ? ctx : { ...ctx, previousIssues: telemetry?.issues ?? [] }
      );
      if (telemetry.playbook || telemetry.status === "TIMEOUT") break;
    }

    this.playbookTelemetry = telemetry;
    this.playbook = telemetry?.playbook ?? null;
    return telemetry;
  }

  /** 作戦に当てはまる手が無い局面を任せる CPU を設定する */
  setTakeoverClient(client: IAgentClient | null): void {
    this.takeoverClient = client;
  }

  /** CPU代行が始まった回数を取り出す。呼ぶと 0 に戻る */
  takeTakeoverEvents(): number {
    const n = this.takeoverEvents;
    this.takeoverEvents = 0;
    return n;
  }

  isCpuTakeover(): boolean {
    return this.cpuTakeover;
  }

  /** HUD 用: いま何に従って動いているか (作戦 / CPU代行)。どちらでもなければ null */
  getControlNote(): string | null {
    if (this.cpuTakeover) {
      const style = this.playbook ? ` [${this.playbook.cpuStyle}]` : "";
      return `🖥️ CPU代行${style}${this.activeSituation ? ` (${this.activeSituation}: 作戦に該当なし)` : ""}`;
    }
    const situation = this.getActiveSituation();
    return situation ? `📋 作戦「${situation}」` : null;
  }

  /** テスト・リプレイ用に作戦を直接与える */
  setPlaybook(playbook: Playbook | null): void {
    this.playbook = playbook;
  }

  getPlaybook(): Playbook | null {
    return this.playbook;
  }

  getPlaybookTelemetry(): PlaybookTelemetry | null {
    return this.playbookTelemetry;
  }

  /** いま作戦で動いているなら、その局面の名前 */
  getActiveSituation(): string | null {
    return this.commitment?.origin === "PLAYBOOK" ? this.activeSituation : null;
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

  /** HUD・デバッグ用: いま何をしているか */
  getMode(): ServoMode {
    return this.mode;
  }

  getSolution(): InterceptSolution | null {
    return this.solution;
  }

  /**
   * 「宣言した狙いを実現する一撃を、いま実際に振り抜いている」か。
   *
   * 相手の打球が構えより先に届いてしまった局面 (= 強制的なブロック) では、
   * どの方向へ返すかを選ぶ余地が物理的に無い。狙いの精度を測るときは、
   * 意図した一撃だけを対象にしないと指標が雑音で埋まる。
   */
  isExecutingStrike(): boolean {
    return this.commitment?.launched ?? false;
  }

  isAwaitingDecision(): boolean {
    return this.awaitingDecision;
  }

  /** 人間操作の場合は制御しない */
  isControlled(): boolean {
    return this.client !== null;
  }

  /** このエージェントがクラウドAPIへ問い合わせるか (判断待ちで時間を止めるかの判定に使う) */
  usesLiveApi(): boolean {
    return this.client?.usesLiveApi ?? false;
  }

  reset(): void {
    this.telemetry = null;
    this.plan = null;
    this.awaitingDecision = false;
    this.centerLineArmed = true;
    this.lastEngaged = false;
    this.touchedThisApproach = false;
    this.apiCooldownUntil = 0;
    this.predictionErrors = [];
    this.ownHalfSec = 0;
    this.activeSituation = null;
    this.cpuTakeover = false;
    this.takeoverEvents = 0;
    this.msSinceDecision = Number.POSITIVE_INFINITY;
    this.trajectory = null;
    this.stepsSincePredict = Number.POSITIVE_INFINITY;
    this.lastPuckVel = new Vec2(0, 0);
    this.mode = "HOME";
    this.solution = null;
    this.commitment = null;
    this.contactCooldownSteps = 0;
  }

  /**
   * 物理エンジンの衝突コールバックから呼ぶ。
   * 接触が予告時刻より早くても遅くても、その瞬間のパック位置で予測誤差を記録する。
   */
  recordContact(puckPos?: Vec2): void {
    this.touchedThisApproach = true;
    this.contactCooldownSteps = CONTACT_COOLDOWN_STEPS;
    if (puckPos) this.scorePrediction(puckPos);
    this.commitment = null;
    this.stepsSincePredict = Number.POSITIVE_INFINITY;
  }

  /**
   * 壁バウンドを伝える。予測を作り直すだけで、実行中の計画には手を付けない —
   * 跳ね返りを読めていたかどうかもエージェントの予測精度のうち。
   */
  notifyWallBounce(): void {
    this.stepsSincePredict = Number.POSITIVE_INFINITY;
  }

  /** 計測された予測誤差 (px) を取り出す。呼ぶと空になる */
  takePredictionErrors(): number[] {
    const errors = this.predictionErrors;
    this.predictionErrors = [];
    return errors;
  }

  /** HUD 描画用: 実行中のエージェント計画の経路 */
  getPlannedPath(): PlannedPath | null {
    const c = this.commitment;
    if (!c || c.source !== "AGENT") return null;
    return {
      start: c.pathStart,
      control: c.pathControl,
      windupPoint: c.windupPoint,
      contactPoint: c.contactPoint,
      expectedPuckPos: c.expectedPuckPos,
    };
  }

  /** この局面でパックに触れられたか (空振り判定用) */
  hasTouchedThisApproach(): boolean {
    return this.touchedThisApproach;
  }

  /**
   * 「自分が動くべき局面か」の判定。
   *
   * 旧実装は `パックが自分の方へ一定速度以上で向かっている` ことを条件にしていたため、
   * 自陣で止まっているパック・自陣を横切るパック・ゆっくり転がるパックに対して
   * 完全に無反応だった。ここでは予測軌道が自陣に入るかどうかで判定する。
   */
  private isEngaged(puck: CircleBody): boolean {
    if (this.isInOwnHalf(puck.pos)) return true;

    const traj = this.trajectory;
    if (!traj) return false;

    for (const sample of traj.samples) {
      if (this.isInOwnHalf(sample.pos)) return true;
    }
    return false;
  }

  private isInOwnHalf(pos: Vec2): boolean {
    return this.side === "TOP" ? pos.y <= this.config.height * 0.52 : pos.y >= this.config.height * 0.48;
  }

  /** パックの状態から軌道予測を作り直す (一定ステップごと) */
  private refreshTrajectory(puck: CircleBody, force = false): void {
    // 相手が打ち返した瞬間は速度が跳ねる。予測を即座に作り直す
    if (puck.vel.sub(this.lastPuckVel).mag() > OPPONENT_HIT_DELTA) {
      force = true;
    }
    this.lastPuckVel = puck.vel.clone();

    if (!force && this.trajectory && this.stepsSincePredict < PREDICT_EVERY_STEPS) {
      this.stepsSincePredict++;
      return;
    }

    this.trajectory = predictPuckPath(puck.pos, puck.vel, this.config, {
      horizonSec: PREDICT_HORIZON_SEC,
    });
    this.stepsSincePredict = 0;
  }

  /**
   * パックの状態を観測し、判断の要否と局面の終了を報告する。
   * 「自陣に関わった一連の流れ」を1局面として数え、その間に触れたかで
   * セーブと空振りを判定する。
   *
   * 判断を求めるのは、パックが中央線を越えて自陣へ入ってきた瞬間だけ。
   * それ以外 (壁バウンド・自陣での減速・打ち損じ) では考え直さない。
   */
  observe(puck: CircleBody): { needsDecision: boolean; approachEnded: "SAVE" | "WHIFF" | null } {
    if (!this.client) return { needsDecision: false, approachEnded: null };

    this.refreshTrajectory(puck);

    const engaged = this.isEngaged(puck);
    let approachEnded: "SAVE" | "WHIFF" | null = null;

    if (engaged && !this.lastEngaged) {
      this.touchedThisApproach = false;
    } else if (!engaged && this.lastEngaged) {
      approachEnded = this.touchedThisApproach ? "SAVE" : "WHIFF";
    }
    this.lastEngaged = engaged;

    const crossed = this.detectCenterLineCrossing(puck);
    if (crossed) {
      // 新しい局面。前の局面の計画も、CPU代行ももう使わない
      this.plan = null;
      this.commitment = null;
      this.cpuTakeover = false;
      this.activeSituation = null;
    }

    // レート制限のクールダウン中は問い合わせない (その局面は計画なしで守る)
    const inCooldown = Date.now() < this.apiCooldownUntil;

    return {
      needsDecision: crossed && !this.awaitingDecision && !inCooldown,
      approachEnded,
    };
  }

  /** パックが中央線を越えて自陣へ入ってきた瞬間か */
  private detectCenterLineCrossing(puck: CircleBody): boolean {
    const mid = this.config.height * 0.5;
    const onMySide = this.side === "TOP" ? puck.pos.y <= mid : puck.pos.y >= mid;

    if (!onMySide) {
      this.centerLineArmed = true;
      return false;
    }
    if (!this.centerLineArmed) return false;

    // 自陣側に入った。向かってこない球・中央線から離れた位置で初めて見つかった球
    // (サーブ直後など) は、中央線での判断の対象ではない
    this.centerLineArmed = false;
    const headingToMe = this.side === "TOP" ? puck.vel.y < 0 : puck.vel.y > 0;
    return headingToMe && Math.abs(puck.pos.y - mid) <= CENTER_LINE_BAND_PX;
  }

  /** ゴールを許した時点で、その局面は空振りとして確定させる */
  finalizeApproach(): "SAVE" | "WHIFF" | null {
    if (!this.client || !this.lastEngaged) return null;
    this.lastEngaged = false;
    return this.touchedThisApproach ? "SAVE" : "WHIFF";
  }

  /** エージェントへ判断を要求する */
  async requestDecision(
    puck: CircleBody,
    myMallet: CircleBody,
    opponentMallet: CircleBody,
    myScore: number,
    opponentScore: number
  ): Promise<AgentTelemetry | null> {
    if (!this.client) return null;

    this.awaitingDecision = true;
    this.msSinceDecision = 0;

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
      // 無効な判断はローカルで救済しない
      this.plan = telemetry.plan;
      // 応答を待つ間もシミュレーションが進んでいた (ライブ対戦) なら、その分だけ
      // 接触までの残り時間は減っている。遅い応答は、そのまま遅い一撃になる
      this.commitment = telemetry.plan
        ? this.buildAgentCommitment(telemetry.plan, myMallet.pos, this.msSinceDecision / 1000, "LIVE")
        : null;

      // 判断が届かなかった (通信失敗・時間切れ・応答不正)。
      // 中央線を越えた瞬間の盤面に、エージェント自身が作戦タイムに決めた作戦を当てはめる
      if (!telemetry.plan && telemetry.status !== "OK" && this.playbook) {
        const situation = this.applyIncomingPlaybook(observation);
        // 作戦はあるが、この局面に当てはまる手が無い。CPU に任せる
        if (situation) await this.startCpuTakeover(situation, observation);
      }

      // 429 エラー (Quota Exceeded) 時はスマートクールダウンを設定し、連打による悪循環を防ぐ
      if (telemetry.status === "ERROR") {
        const errorMsg = telemetry.clampNotes.join(" ");
        if (errorMsg.includes("429") || errorMsg.toLowerCase().includes("quota") || errorMsg.includes("rate-limit")) {
          const match = errorMsg.match(/retry in ([0-9.]+)s/i);
          const waitSec = match ? Math.ceil(parseFloat(match[1])) + 1 : 8;
          this.apiCooldownUntil = Date.now() + waitSec * 1000;
        }
      }

      return telemetry;
    } finally {
      this.awaitingDecision = false;
    }
  }

  /**
   * 中央線での判断が届かなかった局面を、作戦の「相手から来るパック」で打つ。
   * 当てはまる手が無ければ、その局面名を返す (呼び出し側が CPU に任せる)。
   */
  private applyIncomingPlaybook(obs: AirHockeyObservation): string | null {
    if (!this.playbook) return null;

    const traj = predictPuckPath(obs.puckPos, obs.puckVel, this.config, { horizonSec: PREDICT_HORIZON_SEC });
    const situation = classifyIncoming(traj, obs.puckVel, this.side, this.config);
    const move = this.playbook.incoming[situation];
    const plan = move
      ? moveToPlan(move, traj, obs.myMalletPos, this.side, this.limits, this.config, obs.opponentMalletPos, situation)
      : null;
    if (!plan) return situation;

    this.plan = plan;
    this.activeSituation = situation;
    this.commitment = this.buildAgentCommitment(plan, obs.myMalletPos, this.msSinceDecision / 1000, "PLAYBOOK");
    return null;
  }

  /**
   * パックが自陣に居座っている。作戦の「自陣に居座るパック」で打ちに行く。
   * 当てはまる手が無ければ CPU に任せる。
   */
  private applyLingeringPlaybook(myMallet: CircleBody, puck: CircleBody, opponentMalletPos: Vec2): void {
    if (!this.playbook || !this.trajectory) return;

    const situation = classifyLingering(this.trajectory, puck.pos, puck.vel, this.side, this.config);
    const move = this.playbook.lingering[situation];
    const plan = move
      ? moveToPlan(move, this.trajectory, myMallet.pos, this.side, this.limits, this.config, opponentMalletPos, situation)
      : null;

    if (!plan) {
      // CPU 自身は元から CPU の反射で動くので、代行として数えない
      if (this.usesLiveApi() && !this.cpuTakeover) {
        void this.startCpuTakeover(situation, this.observe_(myMallet, puck, opponentMalletPos));
      }
      return;
    }

    this.cpuTakeover = false;
    this.plan = plan;
    this.activeSituation = situation;
    this.commitment = this.buildAgentCommitment(plan, myMallet.pos, 0, "PLAYBOOK");
  }

  /** いまの盤面を、エージェントへ渡す観測の形にする (CPU代行用) */
  private observe_(myMallet: CircleBody, puck: CircleBody, opponentMalletPos: Vec2): AirHockeyObservation {
    return {
      side: this.side,
      puckPos: puck.pos.clone(),
      puckVel: puck.vel.clone(),
      myMalletPos: myMallet.pos.clone(),
      myMalletVel: myMallet.vel.clone(),
      opponentMalletPos: opponentMalletPos.clone(),
      opponentMalletVel: new Vec2(0, 0),
      myScore: 0,
      opponentScore: 0,
      config: this.config,
    };
  }

  /**
   * CPU代行を始める。次に中央線を越えてくるまで、CPU の判断と反射で動く。
   * いまの盤面で、AI が選んだ動作パターンの CPU に1打を決めさせる。
   */
  private async startCpuTakeover(situation: string, obs?: AirHockeyObservation): Promise<void> {
    this.cpuTakeover = true;
    this.takeoverEvents++;
    this.activeSituation = situation;

    if (!obs || !this.takeoverClient) return;
    const telemetry = await this.takeoverClient.decideShot(obs);
    if (!this.cpuTakeover || !telemetry.plan) return;

    this.plan = telemetry.plan;
    this.commitment = this.buildAgentCommitment(telemetry.plan, obs.myMalletPos, this.msSinceDecision / 1000, "CPU");
  }

  /**
   * 1ステップ分マレットを動かす。戦術判断はここには一切存在しない。
   */
  stepServo(dt: number, myMallet: CircleBody, puck: CircleBody, opponentMalletPos?: Vec2): void {
    if (!this.client) return;

    const mid = this.config.height * 0.5;
    const inMyHalf = this.side === "TOP" ? puck.pos.y <= mid : puck.pos.y >= mid;
    this.ownHalfSec = inMyHalf ? this.ownHalfSec + dt : 0;
    this.opponentMalletPos = opponentMalletPos ?? this.opponentMalletPos;

    this.msSinceDecision += dt * 1000;
    if (this.contactCooldownSteps > 0) this.contactCooldownSteps--;
    this.refreshTrajectory(puck);
    this.advanceCommitment(dt, puck);

    const desired = this.desiredVelocity(myMallet, puck);
    this.applyAcceleration(dt, myMallet, desired);
    this.integrateAndConstrain(dt, myMallet);
  }

  /**
   * いま出すべき速度を決める。
   *  SETUP   — 計画された経路 (直線/曲線) を、計画された速度で構え位置へ向かう
   *  STRIKE  — 予告時刻に予告位置を通るよう、振りかぶってから加速し切って振り抜く
   *  DEFEND  — 計画が無い。脅威の進路へ体を入れて弾く
   *  CLEANUP — 自陣に居座る遅い球を掻き出す
   *  HOME    — パックが相手陣にある。守備隊形へ戻りながらパックのx方向へ寄せる
   */
  private desiredVelocity(myMallet: CircleBody, puck: CircleBody): Vec2 {
    const desired = this.planVelocity(myMallet, puck);
    return this.suppressAccidentalContact(myMallet, puck, desired);
  }

  /** 固定した接触時刻の時計を進め、もう成立しない一撃は破棄する */
  private advanceCommitment(dt: number, puck: CircleBody): void {
    const commit = this.commitment;
    if (!commit) return;

    commit.timeLeft -= dt;

    // 予告した接触時刻になった。その瞬間のパック位置で予測の答え合わせをする
    if (commit.timeLeft <= 0) this.scorePrediction(puck.pos);

    // 振り抜き切っても当たらなかった
    if (commit.timeLeft < -COMMITMENT_GRACE_SEC) {
      this.commitment = null;
      return;
    }

    // エージェントの計画は開ループで実行する。予測が外れていても直さない
    if (commit.source === "AGENT") return;

    // CLEANUP の一撃は、予測がずれた (壁バウンドを拾いきれなかった等) なら解き直す
    const traj = this.trajectory;
    if (!traj) return;
    const expected = sampleAt(traj, Math.max(0, commit.timeLeft));
    if (expected && expected.pos.dist(commit.expectedPuckPos) > COMMITMENT_DRIFT_PX) {
      this.commitment = null;
    }
  }

  private planVelocity(myMallet: CircleBody, puck: CircleBody): Vec2 {
    const traj = this.trajectory;
    if (!traj) return new Vec2(0, 0);

    // CPU は計画が無い (または外れた) まま自陣に居座る球を、自前の幾何解で打ちに行く。
    // ゴールを塞ぐだけでは、ゴールに向かわない球 (壁沿いの往復など) に永久に触れない。
    // クラウドAIには使わない — AIの応答が無い局面をローカル演算で肩代わりすると、
    // 「AIを使わないモード」で試合をしていることになる
    // CPU 自身か、CPU代行中なら、CPU の反射 (守備・掻き出し) を使う
    const local = !this.usesLiveApi() || this.cpuTakeover;

    // 自陣に2秒以上居座る球には、中央線での判断の機会が無い。作戦で打ちに行く
    // (打ち終えてもまだ居座っていれば、次の一撃もすぐに作戦で出す)
    if (!this.commitment && !this.awaitingDecision && this.ownHalfSec >= LINGER_THRESHOLD_SEC) {
      this.applyLingeringPlaybook(myMallet, puck, this.opponentMalletPos);
    }

    if (local && !this.commitment && !this.awaitingDecision && this.needsCleanup(puck, traj)) {
      this.tryLocalStrike(myMallet, traj);
    }

    if (this.commitment) {
      this.mode =
        this.commitment.source === "LOCAL" ? "CLEANUP" : this.commitment.launched ? "STRIKE" : "SETUP";
      return this.executeCommitment(myMallet, puck);
    }

    this.solution = null;

    if (!local) {
      // クラウドAIに実行中の計画が無い (判断待ち・時間切れ・通信失敗・一撃の後)。
      // パックを読んで守ったり打ったりはせず、定位置で次の判断を待つ
      this.mode = "NO_PLAN";
      return this.arriveVelocity(myMallet.pos, this.waitingPosition(), this.limits.maxSpeed * 0.75);
    }

    // 打てる一撃がまだ立たなくても、ゴールへ向かわない球は追いかける。
    // ゴール前で待っていても、壁沿いを往復する球は向こうから来てくれない
    if (!this.awaitingDecision && this.needsCleanup(puck, traj)) {
      this.mode = "CLEANUP";
      const ahead = sampleAt(traj, CHASE_LEAD_SEC) ?? traj.samples[0];
      const target = this.clampToOwnHalf(ahead.pos);
      return this.arriveVelocity(myMallet.pos, this.routeAroundPuck(myMallet.pos, target, puck), this.limits.maxSpeed);
    }

    // 中央線を越えてくるまでは構えの位置で待つ。予測軌道が自陣に入るだけで
    // ゴール前へ下がると、中央線で決めた打点へ前に出るのが間に合わなくなる
    if (this.isEngaged(puck) && this.isInOwnHalf(puck.pos)) {
      this.mode = "DEFEND";
      const block = solveBlockPoint(traj, this.side, this.limits, this.config);
      return this.arriveVelocity(myMallet.pos, this.routeAroundPuck(myMallet.pos, block, puck), this.limits.maxSpeed);
    }

    this.mode = "HOME";
    const home = this.routeAroundPuck(myMallet.pos, this.homePosition(puck), puck);
    return this.arriveVelocity(myMallet.pos, home, this.limits.maxSpeed * 0.75);
  }

  private needsCleanup(puck: CircleBody, traj: PuckTrajectory): boolean {
    if (!this.isInOwnHalf(puck.pos)) return false;
    // 自陣ゴールへ向かう速い球は、予測を外した結果。救済せず守備 (進路を塞ぐ) に任せる
    return puck.vel.mag() < CLEANUP_MAX_PUCK_SPEED || traj.goalConcededBy !== this.side;
  }

  /**
   * CLEANUP の一撃をローカルで解く。狙いは直前の計画の狙い (無ければ相手ゴール中央)。
   * 戦術判断ではなく「止まりかけた球を相手陣へ返す」ための反射なので、
   * 予測誤差の統計にも数えない。
   */
  private tryLocalStrike(myMallet: CircleBody, traj: PuckTrajectory): void {
    const { width, height, puckRadius } = this.config;
    const netY = this.side === "TOP" ? height + 30 : -30;
    const goal = new Vec2(width * 0.5, netY);
    const swingSpeed = this.limits.maxSpeed;

    /**
     * 狙いの候補。壁際の球は、壁の反対側から当てる向き (壁の向こうの鏡像を狙う
     * バンク) でしか打点が自陣の内側に収まらないので、直接の狙いが立たなければ
     * 左右のバンクを試す。
     */
    const aims = [
      this.plan?.aimPoint ?? goal,
      goal,
      new Vec2(2 * puckRadius - goal.x, netY),
      new Vec2(2 * (width - puckRadius) - goal.x, netY),
    ];

    let solution: InterceptSolution | null = null;
    for (const aimPoint of aims) {
      const candidate = solveIntercept(traj, myMallet.pos, myMallet.vel, aimPoint, this.limits, this.config, {
        swingSpeed,
        maxLookaheadSec: STRIKE_HORIZON_SEC,
        // 到達と同時にパックが来る打点では振りかぶれない。助走に使いたい時間を伝える
        setupSec: swingSpeed / this.limits.maxAccel + SETUP_MARGIN_SEC,
        windupPx: this.windupDistance(swingSpeed),
      });
      if (!candidate) continue;
      if (!solution || (candidate.feasible && !solution.feasible) || (!solution.feasible && candidate.slackSec > solution.slackSec)) {
        solution = candidate;
      }
      if (solution.feasible) break;
    }

    if (
      solution &&
      (solution.feasible || solution.slackSec > DESPERATE_SLACK_SEC) &&
      this.canAlignInTime(myMallet, solution)
    ) {
      this.solution = solution;
      this.commitment = this.buildCommitment(
        "LOCAL",
        solution.contactPoint,
        solution.swingDir,
        solution.swingSpeed,
        solution.contactTime,
        myMallet.pos,
        0,
        this.limits.maxSpeed,
        solution.puckPosAtContact
      );
    }
  }

  /**
   * 迎撃解を実行する速度。
   *
   * 接触までまだ余裕があるうちは接触点の手前 (振りかぶり点) で待ち、
   * 助走に必要な時間を切ったら接触点を **突き抜ける** ように加速する。
   * これをやらないと、迎撃点に到達して停止した死んだマレットにパックが
   * ぶつかるだけになり、球威も角度も出ない。
   */
  /**
   * いまの速度からスイング方向へ向き直る時間が残っているか。
   *
   * 壁バウンド等で計画を破棄した直後は、マレットが前の一撃の勢いで別方向へ
   * 飛んでいることがある。そこへ間髪入れず新しい一撃をコミットすると、向きが
   * 揃わないまま接触し、狙いと無関係な方向 (計測では最悪 178°) へ打ち出す。
   * 向き直れないなら一撃を諦めて守りに回る方がよい。
   */
  private canAlignInTime(myMallet: CircleBody, sol: InterceptSolution): boolean {
    const along = Math.max(0, myMallet.vel.dot(sol.swingDir));
    const misaligned = myMallet.vel.sub(sol.swingDir.scale(along)).mag();
    const turnSec = misaligned / this.limits.maxAccel;
    return sol.contactTime >= turnSec * ALIGN_SAFETY_FACTOR;
  }

  /** 静止から swingSpeed まで加速しきるのに必要な助走距離 */
  private windupDistance(swingSpeed: number): number {
    const speed = Math.min(this.limits.maxSpeed, Math.max(1, swingSpeed));
    return Math.min(MAX_WINDUP_PX, (speed * speed) / (2 * this.limits.maxAccel));
  }

  /**
   * エージェントの計画を「実行する一撃」として固定する。
   * elapsedSec は判断を求めてから応答が届くまでに進んだシミュレーション時間。
   */
  private buildAgentCommitment(
    plan: ShotPlan,
    malletPos: Vec2,
    elapsedSec: number,
    origin: "LIVE" | "PLAYBOOK" | "CPU"
  ): StrikeCommitment {
    const rad = (plan.swingDirDeg * Math.PI) / 180;
    const swingDir = new Vec2(Math.cos(rad), Math.sin(rad));
    const contactDist = this.config.puckRadius + this.config.malletRadius;

    return this.buildCommitment(
      "AGENT",
      plan.interceptPoint,
      swingDir,
      plan.swingSpeed,
      plan.contactTimeMs / 1000 - elapsedSec,
      malletPos,
      plan.movePath === "CURVE" ? plan.curveOffset : 0,
      plan.moveSpeed,
      // 振り抜く向きに接触するつもりなら、パックはその先にいるはず
      plan.interceptPoint.add(swingDir.scale(contactDist)),
      origin
    );
  }

  /** 接触点・振り抜き・経路を「実行する一撃」として固定する */
  private buildCommitment(
    source: "AGENT" | "LOCAL",
    contactPoint: Vec2,
    swingDir: Vec2,
    rawSwingSpeed: number,
    contactTime: number,
    malletPos: Vec2,
    curveOffset: number,
    moveSpeed: number,
    expectedPuckPos: Vec2,
    origin: "LIVE" | "PLAYBOOK" | "CPU" = "LIVE"
  ): StrikeCommitment {
    const { maxAccel, maxSpeed } = this.limits;
    const swingSpeed = Math.min(maxSpeed, Math.max(1, rawSwingSpeed));

    const windup = this.windupDistance(swingSpeed);
    const windupPoint = this.clampToOwnHalf(contactPoint.sub(swingDir.scale(windup)));
    const runUp = windupPoint.dist(contactPoint);

    const pathStart = malletPos.clone();
    const pathControl = this.clampToOwnHalf(curveControlPoint(pathStart, windupPoint, curveOffset));

    return {
      source,
      origin,
      contactPoint,
      windupPoint,
      swingDir,
      swingSpeed,
      // サーボはマレットをステップ末の位置まで積分してから物理エンジンへ渡し、
      // エンジンはそこからさらに1ステップ分マレットを掃引して衝突を解く。
      // つまりパックの時計に対してマレットは常に1ステップ先行している。
      // 補正しないと接触が1ステップ早まり、法線が予定から10〜15°回る
      timeLeft: contactTime + this.config.fixedDt,
      runUp,
      swingTime: travelTime(runUp, 0, swingSpeed, maxAccel),
      expectedPuckPos,
      launched: false,
      pathStart,
      pathControl,
      pathLength: bezierLength(pathStart, pathControl, windupPoint),
      pathS: 0,
      moveSpeed: Math.min(maxSpeed, Math.max(1, moveSpeed)),
      predictionScored: false,
    };
  }

  /** エージェントの計画について、予告位置と実際のパック位置の差を1回だけ記録する */
  private scorePrediction(puckPos: Vec2): void {
    const commit = this.commitment;
    // 作戦から作った一撃は、ローカルの軌道予測を使って打点を当てはめているので数えない
    if (!commit || commit.source !== "AGENT" || commit.origin !== "LIVE" || commit.predictionScored) return;
    commit.predictionScored = true;
    this.predictionErrors.push(puckPos.dist(commit.expectedPuckPos));
  }

  /**
   * 固定した一撃を実行する。
   *   準備局面 — 振りかぶり点へ回り込んで構え、パックには触れない
   *   打撃局面 — 接触時刻から逆算した加速プロファイルで振り抜く
   */
  private executeCommitment(myMallet: CircleBody, puck: CircleBody): Vec2 {
    const commit = this.commitment!;

    if (!commit.launched) {
      const ready = commit.timeLeft <= commit.swingTime + STRIKE_LEAD_SEC;
      // 助走を確保できないまま時間切れになるなら、その場から振り出すしかない
      if (ready && this.contactCooldownSteps === 0) {
        commit.launched = true;
      }
    }

    if (commit.launched) return this.followCommitment(myMallet);

    if (commit.source === "LOCAL") {
      // 準備局面: 振りかぶり点で速度を殺して構える。
      // パックを突き飛ばしながら回り込むと自陣へ押し込むので、経路は必ず迂回する
      const approach = this.routeAroundPuck(myMallet.pos, commit.windupPoint, puck);
      return this.arriveVelocity(myMallet.pos, approach, this.limits.maxSpeed);
    }

    return this.followPath(myMallet.pos, commit);
  }

  /**
   * 計画された経路を、計画された速度上限でなぞる。
   *
   * 経路上で自分より少し先の点 (先読み点) へ向かい続けることで、曲線でも
   * 角を作らずに進める。速度は「経路の残りで構え位置に止まれる速度」で頭打ちにする。
   */
  private followPath(pos: Vec2, commit: StrikeCommitment): Vec2 {
    const { pathStart, pathControl, windupPoint } = commit;

    while (commit.pathS < 1 && bezierPoint(pathStart, pathControl, windupPoint, commit.pathS).dist(pos) < PATH_LOOKAHEAD_PX) {
      commit.pathS = Math.min(1, commit.pathS + 0.02);
    }

    if (commit.pathS >= 1) return this.arriveVelocity(pos, windupPoint, commit.moveSpeed);

    const carrot = bezierPoint(pathStart, pathControl, windupPoint, commit.pathS);
    const toCarrot = carrot.sub(pos);
    const dist = toCarrot.mag();
    if (dist < 1e-6) return new Vec2(0, 0);

    const remaining = dist + (1 - commit.pathS) * commit.pathLength;
    const stoppable = Math.sqrt(2 * this.limits.maxAccel * remaining * 0.9);
    return toCarrot.scale(Math.min(commit.moveSpeed, stoppable) / dist);
  }

  /**
   * 固定した接触時刻・接触点へ、等加速度プロファイルを追いながら入る。
   *
   * 狙いの精度はそのまま「接触した瞬間のマレット位置の精度」なので、速度だけ
   * 合わせても足りない。残り時間から逆算した理想位置を比例制御で押さえながら、
   * 速度は前向きフィードフォワードで与える。
   */
  private followCommitment(myMallet: CircleBody): Vec2 {
    const commit = this.commitment!;
    const { maxAccel, maxSpeed } = this.limits;

    const tau = Math.max(0, commit.timeLeft);

    /**
     * 接触時刻から逆算した理想位置と速度。振りかぶり点から等加速度で加速し、
     * tau=0 でちょうど最終速度 vEnd に達して接触点を通過する。
     *
     * 以前は「接触点の手前 ½aτ²」を理想位置にしていたが、これは接触点へ向かって
     * **減速していく** 軌道で、フィードフォワードの速度と食い違う。結果として
     * マレットは予定より1〜2ステップ早く接触点に着いて待ち、横から来たパックに
     * 予定と違う角度で当たっていた (跳ね返りを打つ一撃で平均27°の狙い誤差)。
     */
    const vEnd = Math.min(commit.swingSpeed, Math.sqrt(2 * maxAccel * commit.runUp));
    const accelSec = vEnd / maxAccel;
    const behind =
      tau >= accelSec ? commit.runUp : Math.min(commit.runUp, vEnd * tau - 0.5 * maxAccel * tau * tau);
    const idealPos = commit.contactPoint.sub(commit.swingDir.scale(behind));
    const idealSpeed = tau >= accelSec ? 0 : vEnd - maxAccel * tau;

    const toIdeal = idealPos.sub(myMallet.pos);

    /**
     * スイング軸方向 — 予定より前に出ていたら速度を落として待つ。
     *
     * ここを単純な「フィードフォワード + 位置補正」にすると、予定より早く着いた
     * 瞬間に補正が軸の逆向きへ振り切れ、マレットが後退しながらパックに当たる。
     * 計測では実際にこれが起きており、狙いから 178° ずれた打球 (ほぼ真後ろ) が
     * 出ていた。前に出過ぎた場合は止まって待つのが正しく、決して戻ってはいけない。
     */
    const alongError = toIdeal.dot(commit.swingDir);
    const passedContact = commit.contactPoint.sub(myMallet.pos).dot(commit.swingDir) <= 0;

    let along = idealSpeed + alongError * TRACKING_GAIN;
    if (commit.timeLeft > 0) {
      // まだ接触時刻前。接触点を追い越さないよう 0 で下限を切る
      along = Math.max(0, Math.min(commit.swingSpeed, along));
      if (passedContact) along = 0;
    } else {
      // 接触時刻を過ぎた。振り抜き速度のまま通過する
      along = commit.swingSpeed;
    }

    // 軸に直交するズレは接触法線をそのまま回すので、強いゲインで押さえる
    const lateral = toIdeal.sub(commit.swingDir.scale(alongError)).scale(LATERAL_TRACKING_GAIN);

    const desired = commit.swingDir.scale(along).add(lateral);
    const speed = desired.mag();
    return speed > maxSpeed ? desired.scale(maxSpeed / speed) : desired;
  }

  /**
   * 目標点がパックの向こう側にあるとき、パックを押しのけずに回り込むための中継点。
   *
   * 狙いを実現する打点はパックの「狙いと反対側」にあるので、自陣ゴール寄りへ
   * 回り込まなければならない局面が必ず出る。このときパックを突きながら進むと
   * そのまま自陣へ押し込む (実際に自殺点が発生した)。
   *
   * 迂回の向きは **進行方向ではなく「パックから目標へ向かう軸」** を基準に決める。
   * 進行方向を基準にすると、回り込む途中で左右の判定が反転して同じ場所を
   * 行ったり来たりする。
   */
  private routeAroundPuck(from: Vec2, to: Vec2, puck: CircleBody): Vec2 {
    const axis = to.sub(puck.pos);
    const axisLen = axis.mag();
    if (axisLen < 1e-6) return to;

    const u = axis.scale(1 / axisLen);
    const rel = from.sub(puck.pos);

    // 既に目標と同じ側にいるなら、直進してもパックは押さない
    if (rel.dot(u) >= 0) return to;

    const clearance = this.config.puckRadius + this.config.malletRadius + PUCK_CLEARANCE_PX;
    const radius = rel.mag();
    if (radius >= clearance && Math.abs(rel.cross(u)) >= clearance) return to;

    // 回り込む向き。いま居る側を選ぶと最短で回れる
    const perp = new Vec2(-u.y, u.x);
    const lateral = rel.dot(perp);
    const side = Math.abs(lateral) > 1e-3 ? Math.sign(lateral) : this.roomierSide(puck.pos, perp);

    // 中継点はパックを中心とする半径 clearance の円周上に置き、現在の方位から
    // 60°だけ目標側へ回した位置にする。真横を直接指すと、既に接触している状態から
    // パックへ向かって突っ込む向きになり、押しながら回ることになる。
    const radial = radius > 1e-6 ? rel.scale(1 / radius) : perp.scale(side);
    const orbit = radial.scale(0.5).add(perp.scale(side * 0.866)).normalize();

    return this.clampToOwnHalf(puck.pos.add(orbit.scale(clearance)));
  }

  /**
   * 意図しない接触を禁止する最終安全装置。
   *
   * 狙いを実現するのは「振り抜くと決めた一撃」だけで、それ以外の局面 (回り込み・
   * 守備位置への移動・帰陣) でパックに触ってしまうと、法線が無関係な向きを
   * 向いたままインパルスが入る。計測すると、狙いから 80〜170° もずれた打球は
   * すべてこの偶発接触だった (自陣ゴールへの押し込みも含む)。
   *
   * そこでコミット中でなければ、パックへ向かう法線成分だけを落とす。接線方向は
   * 残すので回り込みは止まらない。
   */
  private suppressAccidentalContact(myMallet: CircleBody, puck: CircleBody, desired: Vec2): Vec2 {
    const rel = puck.pos.sub(myMallet.pos);
    const dist = rel.mag();
    if (dist < 1e-6 || dist > this.config.puckRadius + this.config.malletRadius + CONTACT_GUARD_PX) {
      return desired;
    }

    const normal = rel.scale(1 / dist);
    const alongNormal = desired.dot(normal);
    if (alongNormal <= 0) return desired; // パックから離れる向きなら問題ない

    if (this.commitment?.launched) {
      // 振り抜き中でも、自陣ゴールへ押し込む向きだけは許さない
      const towardOwnGoal = this.side === "TOP" ? -normal.y : normal.y;
      if (towardOwnGoal <= OWN_GOAL_PUSH_TOLERANCE) return desired;
    }

    return desired.sub(normal.scale(alongNormal));
  }

  /** パックの左右どちらに逃げ場があるか (コート中央に近い側) */
  private roomierSide(puckPos: Vec2, perp: Vec2): 1 | -1 {
    const center = this.config.width * 0.5;
    const plus = Math.abs(puckPos.x + perp.x * 100 - center);
    const minus = Math.abs(puckPos.x - perp.x * 100 - center);
    return plus <= minus ? 1 : -1;
  }

  /**
   * 目標点で停止できる速度 (到着制御)。
   * 距離に関係なく最大速度で突っ込むと必ず行き過ぎて往復振動するため、
   * 残り距離で止まれる速度に抑える。
   */
  private arriveVelocity(from: Vec2, to: Vec2, maxSpeed: number): Vec2 {
    const toTarget = to.sub(from);
    const dist = toTarget.mag();
    if (dist < 0.5) return new Vec2(0, 0);

    // v = sqrt(2 * a * d) で止まれる。余裕を見て 0.9 を掛ける
    const stoppable = Math.sqrt(2 * this.limits.maxAccel * dist * 0.9);
    return toTarget.scale(Math.min(maxSpeed, stoppable) / dist);
  }

  /**
   * クラウドAIが計画を持たないときの定位置。作戦で決めた待機位置、無ければゴール前の中央。
   * パックの位置には追従しない
   */
  private waitingPosition(): Vec2 {
    if (this.playbook) return this.clampToOwnHalf(this.playbook.readyPosition);
    const { width, height } = this.config;
    return this.clampToOwnHalf(new Vec2(width * 0.5, this.side === "TOP" ? height * 0.18 : height * 0.82));
  }

  /**
   * 待機位置。固定点ではなく、パックの x に合わせてゴール前を横移動する。
   * 相手が打つ前から角度を消しておくのが守備の基本。
   */
  private homePosition(puck: CircleBody): Vec2 {
    const { width, height } = this.config;
    const center = width * 0.5;
    const bias = Math.max(-1, Math.min(1, (puck.pos.x - center) / (width * 0.5)));
    const post = this.config.goalWidth * 0.5;

    const y = this.side === "TOP" ? height * 0.18 : height * 0.82;
    return this.clampToOwnHalf(new Vec2(center + bias * post * 0.75, y));
  }

  private clampToOwnHalf(p: Vec2): Vec2 {
    return new Vec2(
      Math.max(this.limits.minX, Math.min(this.limits.maxX, p.x)),
      Math.max(this.limits.minY, Math.min(this.limits.maxY, p.y))
    );
  }

  /** 最大加速度の制約下で目標速度へ近づける (瞬間的なワープを禁止) */
  private applyAcceleration(dt: number, myMallet: CircleBody, desired: Vec2): void {
    const { maxAccel, maxSpeed } = this.limits;

    const deltaV = desired.sub(myMallet.vel);
    const maxDelta = maxAccel * dt;
    const applied = deltaV.mag() > maxDelta ? deltaV.normalize().scale(maxDelta) : deltaV;

    let next = myMallet.vel.add(applied);
    // 走っている最中に1ステップで進行方向が逆転するカクつきを防止 (一旦止まってから反転する)
    if (myMallet.vel.mag() > 50 && next.mag() > 50 && next.dot(myMallet.vel) < 0) {
      next = new Vec2(0, 0);
    }

    const speed = next.mag();
    if (speed > maxSpeed) {
      next = next.scale(maxSpeed / speed);
    }
    myMallet.vel = next;
  }

  private integrateAndConstrain(dt: number, myMallet: CircleBody): void {
    myMallet.pos = myMallet.pos.add(myMallet.vel.scale(dt));

    if (myMallet.pos.x < this.limits.minX) {
      myMallet.pos.x = this.limits.minX;
      myMallet.vel.x = 0;
    } else if (myMallet.pos.x > this.limits.maxX) {
      myMallet.pos.x = this.limits.maxX;
      myMallet.vel.x = 0;
    }

    if (myMallet.pos.y < this.limits.minY) {
      myMallet.pos.y = this.limits.minY;
      myMallet.vel.y = 0;
    } else if (myMallet.pos.y > this.limits.maxY) {
      myMallet.pos.y = this.limits.maxY;
      myMallet.vel.y = 0;
    }
  }
}
