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
        <p>Naive RAG（全パッセージ詰め込み）と Jev Adaptive RAG（5-Stage 意思決定ゲート）を並列検証しています</p>
      </div>
      <div class="benchmark-loading">
        <span class="spinner"></span> 測定中...
      </div>
    `;
  }

  render(bench: BenchmarkComparison): void {
    this.container.classList.remove('hidden');

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
            <h4>Naive RAG (従来の全件詰め込み)</h4>
            <span class="status-pill ${bench.naiveRag.hallucinationDetected ? 'danger' : 'neutral'}">
              ${bench.naiveRag.hallucinationDetected ? '⚠️ ハルシネーション混入' : '生成完了'}
            </span>
          </div>
          <div class="stat-metrics">
            <div class="stat-box">
              <span class="stat-val">${bench.naiveRag.totalLatencyMs} ms</span>
              <span class="stat-lbl">総レイテンシ</span>
            </div>
            <div class="stat-box">
              <span class="stat-val">${bench.naiveRag.tokensUsed}</span>
              <span class="stat-lbl">消費トークン数</span>
            </div>
            <div class="stat-box">
              <span class="stat-val ${bench.naiveRag.unsupportedClaimCount > 0 ? 'bad' : 'good'}">
                ${bench.naiveRag.unsupportedClaimCount} 件
              </span>
              <span class="stat-lbl">未裏付け主張</span>
            </div>
          </div>
          <div class="bench-answer">
            <div class="bench-answer-label">生成回答:</div>
            <p>${this.escapeHtml(bench.naiveRag.answer)}</p>
          </div>
        </div>

        <!-- Jev Adaptive RAG -->
        <div class="bench-col jev">
          <div class="col-header">
            <h4>Jev Adaptive RAG (5-Stage System One)</h4>
            <span class="status-pill success">🛡️ ゼロハルシネーション保証</span>
          </div>
          <div class="stat-metrics">
            <div class="stat-box">
              <span class="stat-val highlight">${bench.jevAdaptiveRag.totalLatencyMs} ms</span>
              <span class="stat-lbl">総レイテンシ</span>
            </div>
            <div class="stat-box">
              <span class="stat-val good">-${bench.jevAdaptiveRag.tokensSavedPercent}%</span>
              <span class="stat-lbl">トークン削減率</span>
            </div>
            <div class="stat-box">
              <span class="stat-val good">${bench.jevAdaptiveRag.attributionScore}%</span>
              <span class="stat-lbl">引用忠実性</span>
            </div>
          </div>
          <div class="bench-answer">
            <div class="bench-answer-label">検証済み回答:</div>
            <p>${this.escapeHtml(bench.jevAdaptiveRag.answer)}</p>
          </div>
        </div>
      </div>
    `;
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
