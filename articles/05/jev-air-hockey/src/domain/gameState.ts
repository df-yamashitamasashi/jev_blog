/**
 * Game State & Stadium Constants (Clean Architecture - Domain Layer)
 */

import { AgentType } from "./jevAgentTypes";

export enum GameStatus {
  READY = "READY",
  PLAYING = "PLAYING",
  GOAL_SCORED = "GOAL_SCORED",
  GAME_OVER = "GAME_OVER",
  PAUSED = "PAUSED",
}

export interface StadiumConfig {
  width: number;             // コート幅 (600px)
  height: number;            // コート高さ (900px)
  goalWidth: number;         // ゴール幅 (220px)
  puckRadius: number;        // パック半径 (20px)
  malletRadius: number;      // マレット半径 (34px)
  puckMass: number;          // パック質量 (0.05kg)
  malletMass: number;        // マレット質量 (0.35kg)
  maxPuckSpeed: number;      // パック最大速度 (px/s) — 暴走防止の安全網
  puckFriction: number;      // 空気抵抗減衰率
  wallRestitution: number;   // 壁の反発係数
  malletRestitution: number; // マレット衝突時の反発係数 (1.0以下: エネルギー保存)
  maxMalletSpeed: number;    // マレット最大速度 (px/s) — 全エージェント共通
  maxMalletAccel: number;    // マレット最大加速度 (px/s²) — 瞬間的な方向転換を禁止
  decisionBudgetMs: number;  // AI判断1回が消費する「ゲーム内時間」(ms)
  fixedDt: number;           // 固定タイムステップ (秒)
}

export const DEFAULT_STADIUM_CONFIG: StadiumConfig = {
  width: 600,
  height: 900,
  goalWidth: 220,
  puckRadius: 20,
  malletRadius: 34,
  puckMass: 0.05,
  malletMass: 0.35,
  maxPuckSpeed: 2000,
  puckFriction: 0.994,
  wallRestitution: 0.95,
  // 反発係数は 1.0 を超えてはならない。超えると衝突のたびに運動エネルギーが増え、
  // maxPuckSpeed のクランプだけが暴走を抑える非物理的な挙動になる。
  malletRestitution: 0.85,
  maxMalletSpeed: 900,
  maxMalletAccel: 6000,
  // 固定タイムステップちょうど15回ぶん。整数倍にしておかないと、判断ごとに
  // 端数の切り捨てが積もってエージェント間で消費時間がずれる
  decisionBudgetMs: 125,
  fixedDt: 1 / 120,
};

export interface MatchScore {
  player: number; // Bottom side
  jev: number;    // Top side
  targetScore: number;
}

export interface GameMatchState {
  status: GameStatus;
  score: MatchScore;
  rallyCount: number;
  maxSpeedReached: number;
  topAgent: AgentType;
  bottomAgent: AgentType;
  lastScorer: "TOP" | "BOTTOM" | null;
  matchDurationSec: number;
}
