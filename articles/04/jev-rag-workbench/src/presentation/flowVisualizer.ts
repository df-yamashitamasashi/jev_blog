/**
 * Flow Visualizer: draws "who did what, how" for one question as a swimlane sequence diagram
 * (利用者 / Jev / 検索 / LLM), a time breakdown bar, and a step-by-step explanation.
 */

import { ACTORS, Actor, RunRecord, TraceStep, buildTrace } from '../domain/trace';

const LANES: Actor[] = ['user', 'jev', 'search', 'llm'];
const laneCenter = (a: Actor) => (LANES.indexOf(a) + 0.5) * 25;

const STATUS_LABEL: Record<RunRecord['status'], { text: string; cls: string }> = {
  answered: { text: '✨ 回答した', cls: 'pass' },
  no_answer: { text: '🛡️ LLM を呼ばずに「見つかりません」', cls: 'stop' },
  direct: { text: '💬 検索せずに返答', cls: 'info' },
  clarify: { text: '❓ 聞き返した', cls: 'info' },
};

const TIMELINE: { key: keyof RunRecord['timingsMs']; actor: Actor; label: string }[] = [
  { key: 'triage', actor: 'jev', label: 'Jev 判断①' },
  { key: 'retrieval', actor: 'search', label: '検索' },
  { key: 'assess', actor: 'jev', label: 'Jev 判断②' },
  { key: 'generate', actor: 'llm', label: 'LLM 回答作成' },
  { key: 'verify', actor: 'jev', label: 'Jev 判断③' },
];

export interface FlowSource {
  kind: 'replay' | 'simulator' | 'api';
  label: string;
}

export class FlowVisualizer {
  private container: HTMLElement;
  private last: { run: RunRecord; source: FlowSource } | null = null;

  constructor(containerId: string) {
    const el = document.getElementById(containerId);
    if (!el) throw new Error(`Element #${containerId} not found`);
    this.container = el;
    this.container.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-action="replay-animation"]') && this.last) {
        this.render(this.last.run, this.last.source);
      }
    });
  }

  render(run: RunRecord, source: FlowSource): void {
    this.last = { run, source };
    const steps = buildTrace(run);
    this.container.innerHTML = `
      ${this.renderSummary(run, source)}
      ${this.renderTimeline(run)}
      <div class="seq" role="list">
        <div class="seq-head">
          <div class="seq-lanes-head">
            ${LANES.map(
              (a) => `
              <div class="lane-head lane-${a}">
                <span class="lane-icon">${ACTORS[a].icon}</span>
                <span class="lane-name">${ACTORS[a].name}</span>
                <span class="lane-role">${ACTORS[a].role}</span>
              </div>`
            ).join('')}
          </div>
          <div class="seq-card-head">何をしたか</div>
        </div>
        ${steps.map((s, i) => this.renderStep(s, i, run)).join('')}
      </div>
      ${this.renderComparison(run)}
    `;
  }

  // ---------------------------------------------------------------------------

  private renderSummary(run: RunRecord, source: FlowSource): string {
    const status = STATUS_LABEL[run.status];
    return `
      <div class="flow-summary">
        <div class="flow-title-row">
          <h3>🗺️ 動作フロー</h3>
          <span class="source-badge source-${source.kind}">${esc(source.label)}</span>
          <button class="btn-ghost-sm" data-action="replay-animation">↻ もう一度再生</button>
        </div>
        <div class="flow-query">「${esc(run.query)}」</div>
        <div class="flow-metrics">
          <span class="flow-status ${status.cls}">${status.text}</span>
          <span class="metric-pill">合計 <strong>${run.totalMs !== null ? fmtMs(run.totalMs) : '記録なし'}</strong></span>
          <span class="metric-pill">Jev <strong>${run.jevCalls}回</strong></span>
          <span class="metric-pill">LLM <strong>${run.llmTokens > 0 ? `${run.llmTokens}トークン` : '呼ばず'}</strong></span>
        </div>
      </div>`;
  }

  private renderTimeline(run: RunRecord): string {
    const parts = TIMELINE.map((t) => ({ ...t, ms: run.timingsMs[t.key] ?? 0 })).filter((p) => p.ms > 0);
    if (run.totalMs === null || parts.length === 0) {
      return `<div class="flow-timeline"><div class="timeline-label">時間の内訳：この記録には処理時間が残っていません（保存済みの応答から再構成した調整用の記録）</div></div>`;
    }
    const total = parts.reduce((a, p) => a + p.ms, 0);
    const llmSkipped = run.status !== 'answered';
    return `
      <div class="flow-timeline">
        <div class="timeline-label">時間の内訳${llmSkipped ? '（LLM は呼ばれていません）' : ''}</div>
        <div class="timeline-bar">
          ${parts
            .map(
              (p) => `
            <div class="timeline-seg lane-${p.actor}" style="flex-grow:${p.ms}" title="${p.label}: ${fmtMs(p.ms)}">
              ${p.ms / total > 0.12 ? `<span>${p.label} ${fmtMs(p.ms)}</span>` : ''}
            </div>`
            )
            .join('')}
        </div>
        <div class="timeline-legend">
          ${parts.map((p) => `<span><i class="dot lane-${p.actor}"></i>${p.label} ${fmtMs(p.ms)}</span>`).join('')}
        </div>
      </div>`;
  }

  private renderStep(step: TraceStep, index: number, run: RunRecord): string {
    const from = laneCenter(step.from);
    const to = laneCenter(step.to);
    const diagram =
      step.from === step.to
        ? `<div class="seq-self lane-${step.to}" style="left:${to}%">${esc(step.label)}</div>`
        : `<div class="seq-arrow ${to > from ? 'right' : 'left'} lane-${step.to}"
               style="left:${Math.min(from, to)}%; width:${Math.abs(to - from)}%">
             <span class="seq-label">${esc(step.label)}</span>
           </div>`;

    return `
      <div class="seq-row outcome-${step.outcome}" role="listitem" style="animation-delay:${index * 0.45}s">
        <div class="seq-lanes">
          ${LANES.map((a) => `<div class="lifeline" style="left:${laneCenter(a)}%"></div>`).join('')}
          ${diagram}
        </div>
        <div class="seq-card">
          <div class="seq-card-top">
            <span class="step-num">${index + 1}</span>
            <span class="actor-badge lane-${step.actor}">${ACTORS[step.actor].icon} ${ACTORS[step.actor].name}</span>
            <span class="step-title">${esc(step.title)}</span>
            ${step.ms !== undefined ? `<span class="step-ms">${fmtMs(step.ms)}</span>` : ''}
          </div>
          <div class="step-what">${esc(step.what)}</div>
          <div class="step-result outcome-${step.outcome}">→ ${esc(step.result)}</div>
          ${step.passages ? this.renderPassages(step.passages, run.thresholds.relevance) : ''}
          ${step.claims ? this.renderClaims(step.claims, run.thresholds.support) : ''}
          ${step.quote ? `<blockquote class="step-quote">${esc(step.quote).replace(/\n/g, '<br/>')}</blockquote>` : ''}
        </div>
      </div>`;
  }

  private renderPassages(passages: RunRecord['retrieved'], threshold: number): string {
    return `
      <div class="mini-bars">
        ${passages
          .map((p) => {
            const v = p.relevance ?? 0;
            return `
            <div class="mini-bar-row ${p.accepted ? 'ok' : 'ng'}">
              <span class="mini-name" title="${esc(p.text)}">${esc(p.title)}${p.heading ? ` › ${esc(p.heading)}` : ''}</span>
              <span class="mini-track">
                <span class="mini-fill" style="width:${(v / 2) * 100}%"></span>
                <span class="mini-threshold" style="left:${(threshold / 2) * 100}%"></span>
              </span>
              <span class="mini-val">${v.toFixed(2)}点</span>
              <span class="mini-tag">${p.accepted ? '採用' : '除外'}</span>
            </div>`;
          })
          .join('')}
        <div class="mini-note">棒の縦線が基準（${threshold.toFixed(1)}点）。基準以上の文書だけを LLM に渡します。</div>
      </div>`;
  }

  private renderClaims(claims: RunRecord['claims'], threshold: number): string {
    return `
      <div class="mini-bars">
        ${claims
          .map((c) => {
            const state = c.supported === null ? 'skip' : c.supported ? 'ok' : 'ng';
            const tag = c.supported === null ? '照合対象外' : c.supported ? '根拠あり' : '根拠なし';
            const v = c.support ?? 0;
            return `
            <div class="mini-bar-row ${state}">
              <span class="mini-name wide">${esc(c.text)}</span>
              <span class="mini-track">
                <span class="mini-fill" style="width:${v * 100}%"></span>
                <span class="mini-threshold" style="left:${threshold * 100}%"></span>
              </span>
              <span class="mini-val">${c.support === null ? '—' : `${Math.round(v * 100)}%`}</span>
              <span class="mini-tag">${tag}</span>
            </div>`;
          })
          .join('')}
        <div class="mini-note">棒は「文書で裏付けられる」確率。縦線が基準（${Math.round(threshold * 100)}%）です。</div>
      </div>`;
  }

  private renderComparison(run: RunRecord): string {
    const b = run.baseline;
    if (!b) return '';
    const timed = run.totalMs !== null && b.totalMs !== null;
    const delta = timed ? run.totalMs! - b.totalMs! : 0;
    return `
      <div class="flow-compare">
        <h4>⚖️ もしゲートがなかったら（同じ検索・同じ LLM・同じ指示で、毎回 LLM に回答させた場合）</h4>
        <div class="compare-grid">
          <div class="compare-col">
            <div class="compare-head">Jev あり（上の流れ）</div>
            <div class="compare-num">${run.totalMs !== null ? fmtMs(run.totalMs) : '—'}</div>
            <div class="compare-sub">LLM ${run.llmTokens > 0 ? `${run.llmTokens}トークン` : '呼ばず'}</div>
          </div>
          <div class="compare-col">
            <div class="compare-head">ゲートなし</div>
            <div class="compare-num">${b.totalMs !== null ? fmtMs(b.totalMs) : '—'}</div>
            <div class="compare-sub">LLM ${b.llmTokens}トークン</div>
          </div>
          ${
            timed
              ? `<div class="compare-col delta ${delta <= 0 ? 'faster' : 'slower'}">
            <div class="compare-head">差</div>
            <div class="compare-num">${delta <= 0 ? '−' : '+'}${fmtMs(Math.abs(delta))}</div>
            <div class="compare-sub">${delta <= 0 ? 'Jev ありの方が速い' : 'Jev の判断のぶん遅い'}</div>
          </div>`
              : `<div class="compare-col"><div class="compare-head">差</div><div class="compare-num">—</div><div class="compare-sub">時間の記録なし</div></div>`
          }
        </div>
        <div class="compare-answer"><span>ゲートなしの回答：</span>${esc(b.answer).replace(/\n/g, '<br/>')}</div>
      </div>`;
  }
}

function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}秒` : `${Math.round(ms)}ms`;
}

function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
