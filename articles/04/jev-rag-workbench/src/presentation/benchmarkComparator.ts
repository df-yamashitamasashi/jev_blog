/**
 * Benchmark Comparator Component
 * Renders side-by-side comparison between Naive RAG and Jev Adaptive RAG.
 */

import { BenchmarkComparison } from '../domain/models';

export class BenchmarkComparator {
  private container: HTMLElement;

  constructor(containerId: string) {
    const el = document.getElementById(containerId);
    if (!el) throw new Error(`Element #${containerId} not found`);
    this.container = el;
  }

  showRunning(): void {
    this.container.classList.remove('hidden');
    this.container.innerHTML = `
      <div class="benchmark-header">
        <h3>⚖️ A/B ベンチマーク比較実行中...</h3>
        <p>Naive RAG（Top-5 をそのまま LLM に投入）と Jev Adaptive RAG（5つの Jev ゲート経由）を同じ LLM で実行しています</p>
      </div>
      <div class="benchmark-loading">
        <span class="spinner"></span> 測定中...
      </div>
    `;
  }

  render(bench: BenchmarkComparison): void {
    this.container.classList.remove('hidden');

    const jev = bench.jevAdaptiveRag;
    const jevPill = jev.hallucinationDetected
      ? `<span class="status-pill danger">⚠️ 裏付けのない文 ${jev.unsupportedClaimCount} 件を検知</span>`
      : jev.isFallback
      ? '<span class="status-pill success">🛡️ 根拠不足のため生成をスキップ</span>'
      : '<span class="status-pill success">✓ 全文の裏付けを確認</span>';
    const latencyDelta =
      jev.latencyChangePercent <= 0 ? `${Math.abs(jev.latencyChangePercent)}% 短縮` : `${jev.latencyChangePercent}% 増加`;

    this.container.innerHTML = `
      <div class="benchmark-header">
        <div class="benchmark-title-row">
          <h3>⚖️ A/B ベンチマーク比較結果</h3>
          <span class="query-tag">Query: ${this.escapeHtml(bench.query)}</span>
        </div>
      </div>

      <div class="benchmark-grid">
        <!-- Naive RAG -->
        <div class="bench-col naive">
          <div class="col-header">
            <h4>Naive RAG (Top-5 詰め込み)</h4>
            <span class="status-pill ${bench.naiveRag.hallucinationDetected ? 'danger' : 'neutral'}">
              ${bench.naiveRag.hallucinationDetected ? '⚠️ 裏付けのない文を含む' : '生成完了'}
            </span>
          </div>
          <div class="stat-metrics">
            <div class="stat-box">
              <span class="stat-val">${bench.naiveRag.totalLatencyMs} ms</span>
              <span class="stat-lbl">総レイテンシ</span>
            </div>
            <div class="stat-box">
              <span class="stat-val">${bench.naiveRag.tokensUsed}</span>
              <span class="stat-lbl">LLMトークン数</span>
            </div>
            <div class="stat-box">
              <span class="stat-val ${bench.naiveRag.unsupportedClaimCount > 0 ? 'bad' : 'good'}">
                ${bench.naiveRag.unsupportedClaimCount} 件
              </span>
              <span class="stat-lbl">未裏付け文</span>
            </div>
          </div>
          <div class="bench-answer">
            <div class="bench-answer-label">生成回答:</div>
            <p>${this.formatAnswer(bench.naiveRag.answer)}</p>
          </div>
        </div>

        <!-- Jev Adaptive RAG -->
        <div class="bench-col jev">
          <div class="col-header">
            <h4>Jev Adaptive RAG (5 Gates)</h4>
            ${jevPill}
          </div>
          <div class="stat-metrics">
            <div class="stat-box">
              <span class="stat-val highlight">${jev.totalLatencyMs} ms</span>
              <span class="stat-lbl">総レイテンシ（${latencyDelta}）</span>
            </div>
            <div class="stat-box">
              <span class="stat-val ${jev.tokensSavedPercent > 0 ? 'good' : ''}">${jev.tokensUsed}</span>
              <span class="stat-lbl">LLMトークン数（${jev.tokensSavedPercent}% 削減）</span>
            </div>
            <div class="stat-box">
              <span class="stat-val ${jev.unsupportedClaimCount > 0 ? 'bad' : 'good'}">${jev.unsupportedClaimCount} 件</span>
              <span class="stat-lbl">未裏付け文</span>
            </div>
          </div>
          <div class="bench-answer">
            <div class="bench-answer-label">${jev.isFallback ? '安全フォールバック:' : '回答:'}</div>
            <p>${this.formatAnswer(jev.answer)}</p>
          </div>
        </div>
      </div>
    `;
  }

  private formatAnswer(text: string): string {
    return this.escapeHtml(text).replace(/\n/g, '<br/>');
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
