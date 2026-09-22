/**
 * Tournament Orchestrator (Clean Architecture - UseCases Layer)
 *
 * 画面から設定した条件で総当たり戦を回し、結果を集計する。
 * 表裏を入れ替えて同数ずつ戦わせるので、コートの上下差は打ち消される。
 */

import { AgentType, AgentStats, createEmptyStats } from "../domain/jevAgentTypes";
import { GameLoopUseCase } from "./gameLoopUseCase";

export interface TournamentConfig {
  agents: AgentType[];
  matchesPerPairing: number;
  targetScore: number;
  maxRallies: number;
}

export interface TournamentProgress {
  running: boolean;
  completedMatches: number;
  totalMatches: number;
  currentTop: AgentType | null;
  currentBottom: AgentType | null;
  standings: AgentStats[];
  totalApiCalls: number;
}

interface ScheduledMatch {
  top: AgentType;
  bottom: AgentType;
  seed: number;
}

export class TournamentUseCase {
  private readonly gameLoop: GameLoopUseCase;

  private schedule: ScheduledMatch[] = [];
  private cursor = 0;
  private running = false;
  private matchStarted = false;
  private totals = new Map<AgentType, AgentStats>();
  private config: TournamentConfig | null = null;

  private onProgress?: (progress: TournamentProgress) => void;

  constructor(gameLoop: GameLoopUseCase) {
    this.gameLoop = gameLoop;
  }

  setOnProgress(handler: (progress: TournamentProgress) => void): void {
    this.onProgress = handler;
  }

  isRunning(): boolean {
    return this.running;
  }

  /** 総当たりの対戦表を組む。各ペアは表裏を均等に入れ替える */
  static buildSchedule(config: TournamentConfig): ScheduledMatch[] {
    const matches: ScheduledMatch[] = [];
    let seed = 1;

    for (let i = 0; i < config.agents.length; i++) {
      for (let j = i + 1; j < config.agents.length; j++) {
        for (let m = 0; m < config.matchesPerPairing; m++) {
          const swap = m % 2 === 1;
          matches.push({
            top: swap ? config.agents[j] : config.agents[i],
            bottom: swap ? config.agents[i] : config.agents[j],
            seed: seed++,
          });
        }
      }
    }

    return matches;
  }

  start(config: TournamentConfig): void {
    this.config = config;
    this.schedule = TournamentUseCase.buildSchedule(config);
    this.cursor = 0;
    this.running = this.schedule.length > 0;
    this.matchStarted = false;

    this.totals = new Map(config.agents.map((a) => [a, createEmptyStats(a)]));
    this.emitProgress();
  }

  abort(): void {
    this.running = false;
    this.matchStarted = false;
    this.emitProgress();
  }

  /**
   * 描画ループから毎フレーム呼ぶ。1フレームぶんだけ試合を進める。
   * 進行は非同期 (AIの応答待ちがあるため) なので、呼び出し側は await しなくてよい。
   */
  async tick(stepsPerFrame: number): Promise<void> {
    if (!this.running || !this.config) return;

    const match = this.schedule[this.cursor];
    if (!match) {
      this.running = false;
      this.emitProgress();
      return;
    }

    if (!this.matchStarted) {
      this.gameLoop.setMatchup(match.top, match.bottom);
      this.gameLoop.startMatch(this.config.targetScore, match.seed, this.config.maxRallies);
      this.matchStarted = true;
      this.emitProgress();
      return;
    }

    await this.gameLoop.advance(stepsPerFrame);

    if (this.gameLoop.isFinished()) {
      this.collectResult();
      this.cursor++;
      this.matchStarted = false;
      if (this.cursor >= this.schedule.length) this.running = false;
      this.emitProgress();
    }
  }

  getProgress(): TournamentProgress {
    const match = this.schedule[this.cursor];
    return {
      running: this.running,
      completedMatches: this.cursor,
      totalMatches: this.schedule.length,
      currentTop: match?.top ?? null,
      currentBottom: match?.bottom ?? null,
      standings: this.rankedStandings(),
      totalApiCalls: [...this.totals.values()].reduce((sum, s) => sum + s.apiCalls, 0),
    };
  }

  private collectResult(): void {
    const { top, bottom } = this.gameLoop.getStats();
    this.mergeInto(top);
    this.mergeInto(bottom);
  }

  private mergeInto(source: AgentStats): void {
    const total = this.totals.get(source.agent);
    if (!total) return;

    total.matches += source.matches;
    total.wins += source.wins;
    total.losses += source.losses;
    total.draws += source.draws;
    total.goalsFor += source.goalsFor;
    total.goalsAgainst += source.goalsAgainst;
    total.decisions += source.decisions;
    total.saves += source.saves;
    total.whiffs += source.whiffs;
    total.clamped += source.clamped;
    total.invalid += source.invalid;
    total.errors += source.errors;
    total.timeouts += source.timeouts;
    total.aimErrorSumDeg += source.aimErrorSumDeg;
    total.aimErrorSamples += source.aimErrorSamples;
    total.latencySumMs += source.latencySumMs;
    total.latencySamples += source.latencySamples;
    total.apiCalls += source.apiCalls;
  }

  /** 勝利数 → 得失点差 の順に並べる */
  private rankedStandings(): AgentStats[] {
    return [...this.totals.values()].sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      return b.goalsFor - b.goalsAgainst - (a.goalsFor - a.goalsAgainst);
    });
  }

  private emitProgress(): void {
    this.onProgress?.(this.getProgress());
  }
}

/** 表示用の派生指標 */
export function saveRate(stats: AgentStats): number {
  const attempts = stats.saves + stats.whiffs;
  return attempts === 0 ? 0 : stats.saves / attempts;
}

export function failureRate(stats: AgentStats): number {
  if (stats.decisions === 0) return 0;
  return (stats.invalid + stats.errors + stats.timeouts) / stats.decisions;
}

export function meanAimErrorDeg(stats: AgentStats): number | null {
  return stats.aimErrorSamples === 0 ? null : stats.aimErrorSumDeg / stats.aimErrorSamples;
}

export function meanLatencyMs(stats: AgentStats): number | null {
  return stats.latencySamples === 0 ? null : stats.latencySumMs / stats.latencySamples;
}
