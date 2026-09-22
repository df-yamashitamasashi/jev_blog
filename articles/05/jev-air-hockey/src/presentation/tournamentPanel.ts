/**
 * Tournament Setup & Results Panel (Clean Architecture - Presentation Layer)
 *
 * 設定・実行・結果表示をすべて画面上で完結させる。
 */

import { AgentType, AGENT_PROFILES, AgentStats } from "../domain/jevAgentTypes";
import { AgentFactory } from "../adapters/agentFactory";
import {
  CLAUDE_MODELS,
  GEMINI_MODELS,
  EFFORT_LEVELS,
  ModelSettings,
  EffortLevel,
} from "../adapters/modelSettings";
import {
  TournamentConfig,
  TournamentProgress,
  TournamentUseCase,
  saveRate,
  failureRate,
  meanAimErrorDeg,
  meanLatencyMs,
} from "../usecases/tournamentUseCase";

const CANDIDATES = [AgentType.CPU, AgentType.JEV, AgentType.GEMINI, AgentType.CLAUDE];

export class TournamentPanel {
  private readonly root: HTMLElement;
  private readonly tournament: TournamentUseCase;

  constructor(root: HTMLElement, tournament: TournamentUseCase) {
    this.root = root;
    this.tournament = tournament;

    this.render();
    this.bind();
    this.tournament.setOnProgress((p) => this.renderProgress(p));
  }

  private render(): void {
    const available = AgentFactory.availableAgents();

    this.root.innerHTML = `
      <div class="card-header">
        <div class="card-title">🏆 TOURNAMENT</div>
      </div>

      <div class="tp-section">
        <div class="tp-label">参加エージェント</div>
        <div class="tp-agents">
          ${CANDIDATES.map((agent) => {
            const usable = available.includes(agent);
            return `
              <label class="tp-agent ${usable ? "" : "disabled"}">
                <input type="checkbox" data-agent="${agent}" ${usable ? "checked" : "disabled"}>
                <span>${escapeHtml(AGENT_PROFILES[agent].displayName)}</span>
                ${usable ? "" : `<em>要APIキー</em>`}
              </label>`;
          }).join("")}
        </div>
      </div>

      <div class="tp-section tp-grid">
        <label>Claudeモデル
          <select id="tp-claude-model">
            ${CLAUDE_MODELS.map(
              (m) =>
                `<option value="${escapeHtml(m.id)}" ${m.id === ModelSettings.getClaudeModel() ? "selected" : ""}>${escapeHtml(m.label)} — ${escapeHtml(m.note)}</option>`
            ).join("")}
          </select>
        </label>
        <label>Geminiモデル
          <select id="tp-gemini-model">
            ${GEMINI_MODELS.map(
              (m) =>
                `<option value="${escapeHtml(m.id)}" ${m.id === ModelSettings.getGeminiModel() ? "selected" : ""}>${escapeHtml(m.label)}</option>`
            ).join("")}
          </select>
        </label>
        <label>思考の深さ (effort)
          <select id="tp-effort">
            ${EFFORT_LEVELS.map(
              (e) => `<option value="${e}" ${e === ModelSettings.getEffort() ? "selected" : ""}>${e}</option>`
            ).join("")}
          </select>
        </label>
        <label>ペアあたり試合数
          <input id="tp-matches" type="number" min="1" max="20" value="1">
        </label>
        <label>目標得点
          <input id="tp-target" type="number" min="1" max="15" value="3">
        </label>
        <label>最大ラリー数 (課金上限)
          <input id="tp-rallies" type="number" min="5" max="500" value="60">
        </label>
      </div>

      <div class="tp-actions">
        <button id="tp-start" class="btn btn-primary">🏁 総当たり戦を開始</button>
        <button id="tp-abort" class="btn" disabled>⏹ 中断</button>
      </div>

      <div id="tp-status" class="tp-status">未実行</div>
      <div id="tp-results" class="tp-results"></div>
    `;

    injectStylesOnce();
  }

  private bind(): void {
    this.root.querySelector("#tp-claude-model")?.addEventListener("change", (e) => {
      ModelSettings.setClaudeModel((e.target as HTMLSelectElement).value);
    });
    this.root.querySelector("#tp-gemini-model")?.addEventListener("change", (e) => {
      ModelSettings.setGeminiModel((e.target as HTMLSelectElement).value);
    });
    this.root.querySelector("#tp-effort")?.addEventListener("change", (e) => {
      ModelSettings.setEffort((e.target as HTMLSelectElement).value as EffortLevel);
    });

    this.root.querySelector("#tp-start")?.addEventListener("click", () => this.handleStart());
    this.root.querySelector("#tp-abort")?.addEventListener("click", () => this.tournament.abort());
  }

  private handleStart(): void {
    const agents = [...this.root.querySelectorAll<HTMLInputElement>("input[data-agent]")]
      .filter((el) => el.checked && !el.disabled)
      .map((el) => el.dataset.agent as AgentType);

    if (agents.length < 2) {
      this.setStatus("参加エージェントを2つ以上選んでください。");
      return;
    }

    const config: TournamentConfig = {
      agents,
      matchesPerPairing: this.readNumber("#tp-matches", 1),
      targetScore: this.readNumber("#tp-target", 3),
      maxRallies: this.readNumber("#tp-rallies", 60),
    };

    const pairings = (agents.length * (agents.length - 1)) / 2;
    const totalMatches = pairings * config.matchesPerPairing;
    const llmAgents = agents.filter((a) => a !== AgentType.CPU).length;
    const worstCaseCalls = totalMatches * config.maxRallies * llmAgents;

    if (
      llmAgents > 0 &&
      !window.confirm(
        `${totalMatches} 試合を実行します。\n` +
          `API呼び出しは最大およそ ${worstCaseCalls.toLocaleString()} 回 (実際の課金が発生します)。\n\n` +
          `開始してよろしいですか?`
      )
    ) {
      return;
    }

    this.tournament.start(config);
    this.toggleRunningUi(true);
  }

  private readNumber(selector: string, fallback: number): number {
    const el = this.root.querySelector<HTMLInputElement>(selector);
    const value = Number(el?.value);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  private renderProgress(p: TournamentProgress): void {
    this.toggleRunningUi(p.running);

    if (p.running && p.currentTop && p.currentBottom) {
      this.setStatus(
        `${p.completedMatches + 1} / ${p.totalMatches} 試合目 — ` +
          `${AGENT_PROFILES[p.currentTop].displayName} vs ${AGENT_PROFILES[p.currentBottom].displayName}` +
          ` / API呼び出し ${p.totalApiCalls.toLocaleString()} 回`
      );
    } else if (p.totalMatches > 0) {
      this.setStatus(
        `完了: ${p.completedMatches} / ${p.totalMatches} 試合 — API呼び出し ${p.totalApiCalls.toLocaleString()} 回`
      );
    }

    const results = this.root.querySelector("#tp-results");
    if (results) results.innerHTML = renderStandings(p.standings);
  }

  private toggleRunningUi(running: boolean): void {
    const start = this.root.querySelector<HTMLButtonElement>("#tp-start");
    const abort = this.root.querySelector<HTMLButtonElement>("#tp-abort");
    if (start) start.disabled = running;
    if (abort) abort.disabled = !running;
  }

  private setStatus(text: string): void {
    const el = this.root.querySelector("#tp-status");
    if (el) el.textContent = text;
  }
}

function renderStandings(standings: AgentStats[]): string {
  if (standings.length === 0) return "";

  const rows = standings
    .map((s) => {
      const aim = meanAimErrorDeg(s);
      const latency = meanLatencyMs(s);
      return `
        <tr>
          <td>${escapeHtml(AGENT_PROFILES[s.agent].displayName)}</td>
          <td>${s.wins}-${s.losses}-${s.draws}</td>
          <td>${s.goalsFor}/${s.goalsAgainst}</td>
          <td>${pct(saveRate(s))}</td>
          <td>${pct(failureRate(s))}</td>
          <td>${aim === null ? "—" : `${aim.toFixed(1)}°`}</td>
          <td>${latency === null ? "—" : `${Math.round(latency)}ms`}</td>
        </tr>`;
    })
    .join("");

  return `
    <table class="tp-table">
      <thead>
        <tr>
          <th>エージェント</th>
          <th title="勝-敗-分">成績</th>
          <th title="得点/失点">得失点</th>
          <th title="届く位置に来たパックを返せた割合">セーブ率</th>
          <th title="応答不正・通信エラー・時間切れの割合">失敗率</th>
          <th title="宣言した狙いと実際の飛翔方向の差">狙い誤差</th>
          <th title="実測の往復時間。勝敗には影響しない">遅延</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

let stylesInjected = false;

function injectStylesOnce(): void {
  if (stylesInjected) return;
  stylesInjected = true;

  const style = document.createElement("style");
  style.textContent = `
    .tp-section { margin-bottom: 12px; }
    .tp-label { font-size: 11px; letter-spacing: 1px; opacity: 0.7; margin-bottom: 6px; }
    .tp-agents { display: flex; flex-wrap: wrap; gap: 8px; }
    .tp-agent { display: flex; align-items: center; gap: 5px; font-size: 12px; cursor: pointer; }
    .tp-agent.disabled { opacity: 0.45; cursor: not-allowed; }
    .tp-agent em { font-size: 10px; opacity: 0.7; font-style: normal; }
    .tp-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .tp-grid label { display: flex; flex-direction: column; gap: 3px; font-size: 11px; opacity: 0.85; }
    .tp-grid select, .tp-grid input {
      background: rgba(0,0,0,0.4); color: inherit; font: inherit; font-size: 12px;
      border: 1px solid rgba(255,255,255,0.18); border-radius: 4px; padding: 4px 6px;
    }
    .tp-actions { display: flex; gap: 8px; margin: 10px 0 8px; }
    .tp-actions .btn { flex: 1; }
    .tp-status { font-size: 11px; opacity: 0.85; margin-bottom: 8px; }
    .tp-table { width: 100%; border-collapse: collapse; font-size: 11px; }
    .tp-table th, .tp-table td { padding: 4px 5px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.1); }
    .tp-table th { opacity: 0.65; font-weight: 500; white-space: nowrap; }
    .tp-table tbody tr:first-child td { color: #fbbf24; font-weight: 600; }
  `;
  document.head.appendChild(style);
}
