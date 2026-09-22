/**
 * Agent Servo Controller (Clean Architecture - UseCases Layer)
 *
 * このクラスは戦術判断を一切行わない。エージェントが返した ShotPlan の「狙い」を、
 * 物理的な制約 (最大速度・最大加速度・自陣の範囲) の中で忠実に実現するための
 * サーボ機構である。どこを狙い、どれだけ強く打つかは完全にAI側の責任。
 *
 * 旧実装との決定的な違い:
 *   - 一度決めた静止点へ走って止まるのではなく、毎ステップ再予測した軌道に対して
 *     迎撃解を解き直す (= 相手の打球が変わればその場で追従する)。
 *   - 狙いはスイング方向ではなく **接触法線** で実現する ([[interception]])。
 *     そのためにパックの裏側へ回り込む。
 *   - 接触の瞬間にマレットが動いているよう、事前に振りかぶって加速し切る。
 *   - 計画が無い/間に合わない局面でも棒立ちにならず、脅威の進路へ体を入れる。
 */

import { Vec2, CircleBody } from "../domain/physics";
import { AgentTelemetry, AgentType, ShotPlan } from "../domain/jevAgentTypes";
import { StadiumConfig } from "../domain/gameState";
import { PlaySide } from "../domain/shotPlanValidator";
import { IAgentClient, AirHockeyObservation } from "../adapters/agentClient";
import { PuckTrajectory, predictPuckPath, sampleAt } from "../domain/puckPredictor";
import {
  InterceptSolution,
  MalletLimits,
  limitsFor,
  solveBlockPoint,
  solveIntercept,
  travelTime,
} from "../domain/interception";

/**
 * 再判断の安全網。軌道が変わる意味のあるイベント (壁バウンド・相手の打球) が
 * 起きなくても、この間隔で一度は考え直す。短くするほど戦術の鮮度は上がるが、
 * 実APIのエージェントでは呼び出し回数がそのまま課金とレイテンシになる。
 */
const REDECIDE_SAFETY_NET_MS = 1100;

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

export type ServoMode = "SETUP" | "STRIKE" | "DEFEND" | "HOME";

/**
 * 実行中の一撃。振り始めたら接触予定時刻を固定し、自前の時計で追い込む。
 *
 * 毎ステップ解き直した接触時刻をそのまま使うと、解が更新されるたびに残り時間が
 * リセットされ、加速プロファイル上の経過時間がいつまでも 0 付近に留まる。
 * 結果としてマレットは振りかぶり点の周りで固まり、パックに押し負ける。
 */
interface StrikeCommitment {
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
  /** 固定した時点で予測していた接触地点のパック位置 (ズレ検知用) */
  expectedPuckPos: Vec2;
  /** すでに振り始めたか。振り始めるまではパックに触れない */
  launched: boolean;
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
  private decisionArmed = true;
  private lastEngaged = false;
  private touchedThisApproach = false;
  private msSinceDecision = Number.POSITIVE_INFINITY;

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
    this.decisionArmed = true;
    this.lastEngaged = false;
    this.touchedThisApproach = false;
    this.msSinceDecision = Number.POSITIVE_INFINITY;
    this.trajectory = null;
    this.stepsSincePredict = Number.POSITIVE_INFINITY;
    this.lastPuckVel = new Vec2(0, 0);
    this.mode = "HOME";
    this.solution = null;
    this.commitment = null;
    this.contactCooldownSteps = 0;
  }

  /** 物理エンジンの衝突コールバックから呼ぶ */
  recordContact(): void {
    this.touchedThisApproach = true;
    this.contactCooldownSteps = CONTACT_COOLDOWN_STEPS;
    this.commitment = null;
    // 打ち返した直後は状況が一変する。次の局面を考え直す
    this.decisionArmed = true;
    this.stepsSincePredict = Number.POSITIVE_INFINITY;
  }

  /**
   * 軌道が変わった (壁バウンド・相手の打球) ことを伝える。
   * 関与中であれば次の observe() で再判断を要求する。
   */
  notifyWallBounce(): void {
    this.stepsSincePredict = Number.POSITIVE_INFINITY;
    // 軌道が変わったなら、振っている途中の一撃はもう狙いを実現しない
    this.commitment = null;
    if (this.lastEngaged) {
      this.decisionArmed = true;
    }
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
      this.commitment = null;
      if (this.lastEngaged) this.decisionArmed = true;
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
   */
  observe(puck: CircleBody): { needsDecision: boolean; approachEnded: "SAVE" | "WHIFF" | null } {
    if (!this.client) return { needsDecision: false, approachEnded: null };

    this.refreshTrajectory(puck);

    const engaged = this.isEngaged(puck);
    let approachEnded: "SAVE" | "WHIFF" | null = null;

    if (engaged && !this.lastEngaged) {
      this.decisionArmed = true;
      this.touchedThisApproach = false;
    } else if (!engaged && this.lastEngaged) {
      approachEnded = this.touchedThisApproach ? "SAVE" : "WHIFF";
    }
    this.lastEngaged = engaged;

    const dueForRedecision = engaged && this.msSinceDecision >= REDECIDE_SAFETY_NET_MS;

    return {
      needsDecision: !this.awaitingDecision && engaged && (this.decisionArmed || dueForRedecision),
      approachEnded,
    };
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
      // 無効な判断はローカルで救済しない。計画が無ければ攻撃はせず、守りに徹する
      this.plan = telemetry.plan;
      this.msSinceDecision = 0;
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

    this.msSinceDecision += dt * 1000;
    if (this.contactCooldownSteps > 0) this.contactCooldownSteps--;
    this.refreshTrajectory(puck);
    this.advanceCommitment(dt);

    const desired = this.desiredVelocity(myMallet, puck);
    this.applyAcceleration(dt, myMallet, desired);
    this.integrateAndConstrain(dt, myMallet);
  }

  /**
   * いま出すべき速度を決める。
   *  STRIKE — 狙いを実現する接触点へ、振りかぶってから加速し切って入る
   *  DEFEND — 打ち返せない球。脅威の進路へ体を入れて弾く
   *  HOME   — パックが相手陣にある。守備隊形へ戻りながらパックのx方向へ寄せる
   */
  private desiredVelocity(myMallet: CircleBody, puck: CircleBody): Vec2 {
    const desired = this.planVelocity(myMallet, puck);
    return this.suppressAccidentalContact(myMallet, puck, desired);
  }

  /** 固定した接触時刻の時計を進め、もう成立しない一撃は破棄する */
  private advanceCommitment(dt: number): void {
    const commit = this.commitment;
    if (!commit) return;

    commit.timeLeft -= dt;

    // 振り抜き切っても当たらなかった
    if (commit.timeLeft < -COMMITMENT_GRACE_SEC) {
      this.commitment = null;
      return;
    }

    // 予測がずれた (壁バウンドを拾いきれなかった等) なら解き直す
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

    // 一度振ると決めた一撃は、軌道が変わるまで打点を動かさない。
    // 毎ステップ解き直すと、打点がパックを追って後退し続け、結果として
    // 「最初だけ勢いがあって、あとはパックを追いかけるだけ」の動きになる
    if (!this.commitment && this.plan) {
      const solution = solveIntercept(
        traj,
        myMallet.pos,
        myMallet.vel,
        this.plan.aimPoint,
        this.limits,
        this.config,
        {
          swingSpeed: this.plan.swingSpeed,
          maxLookaheadSec: STRIKE_HORIZON_SEC,
          preferPoint: this.plan.interceptPoint,
          // 到達と同時にパックが来る打点では振りかぶれない。助走に使いたい時間を伝える
          setupSec: this.plan.swingSpeed / this.limits.maxAccel + SETUP_MARGIN_SEC,
          windupPx: this.windupDistance(this.plan.swingSpeed),
        }
      );

      if (
        solution &&
        (solution.feasible || solution.slackSec > DESPERATE_SLACK_SEC) &&
        this.canAlignInTime(myMallet, solution)
      ) {
        this.solution = solution;
        this.commitment = this.buildCommitment(solution);
      }
    }

    if (this.commitment) {
      this.mode = this.commitment.launched ? "STRIKE" : "SETUP";
      return this.executeCommitment(myMallet, puck);
    }

    this.solution = null;

    if (this.isEngaged(puck)) {
      this.mode = "DEFEND";
      const block = solveBlockPoint(traj, this.side, this.limits, this.config);
      return this.arriveVelocity(myMallet.pos, this.routeAroundPuck(myMallet.pos, block, puck), this.limits.maxSpeed);
    }

    this.mode = "HOME";
    const home = this.routeAroundPuck(myMallet.pos, this.homePosition(puck), puck);
    return this.arriveVelocity(myMallet.pos, home, this.limits.maxSpeed * 0.75);
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

  /** 迎撃解を「実行する一撃」として固定する */
  private buildCommitment(sol: InterceptSolution): StrikeCommitment {
    const { maxAccel, maxSpeed } = this.limits;
    const swingSpeed = Math.min(maxSpeed, Math.max(1, sol.swingSpeed));

    const windup = this.windupDistance(swingSpeed);
    const windupPoint = this.clampToOwnHalf(sol.contactPoint.sub(sol.swingDir.scale(windup)));
    const runUp = windupPoint.dist(sol.contactPoint);

    return {
      contactPoint: sol.contactPoint,
      windupPoint,
      swingDir: sol.swingDir,
      swingSpeed,
      timeLeft: Math.max(sol.contactTime, 0),
      runUp,
      swingTime: travelTime(runUp, 0, swingSpeed, maxAccel),
      expectedPuckPos: sol.puckPosAtContact,
      launched: false,
    };
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

    // 準備局面: 振りかぶり点で速度を殺して構える。
    // パックを突き飛ばしながら回り込むと自陣へ押し込むので、経路は必ず迂回する
    const approach = this.routeAroundPuck(myMallet.pos, commit.windupPoint, puck);
    return this.arriveVelocity(myMallet.pos, approach, this.limits.maxSpeed);
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

    // 接触時刻から逆算した理想位置。tau=0 でちょうど接触点に一致し、それより先へは出ない
    const behind = Math.min(commit.runUp, 0.5 * maxAccel * tau * tau);
    const idealPos = commit.contactPoint.sub(commit.swingDir.scale(behind));

    const elapsed = Math.max(0, commit.swingTime - tau);
    const idealSpeed = Math.min(commit.swingSpeed, maxAccel * elapsed);

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
