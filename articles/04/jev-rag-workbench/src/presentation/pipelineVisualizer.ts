/**
 * Pipeline Visualizer Component
 * Renders real-time stage progression, Jev probabilities, scores, tokens, and verified citations.
 */

import { ClaimVerification, PipelineStageRecord, RagResult, RerankedPassage } from '../domain/models';

export class PipelineVisualizer {
  private container: HTMLElement;

  constructor(containerId: string) {
    const el = document.getElementById(containerId);
    if (!el) throw new Error(`Element #${containerId} not found`);
    this.container = el;
  }

  reset(): void {
    this.container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚡</div>
        <h3>パイプライン待機中</h3>
        <p>クエリを入力して「Jev RAG パイプライン実行」を押すと、リアルタイムに5つの意思決定ゲートが可視化されます。</p>
      </div>
    `;
  }

  showRunning(query: string): void {
    this.container.innerHTML = `
      <div class="pipeline-header">
        <div class="query-badge">
          <span class="label">QUERY:</span>
          <span class="text">${this.escapeHtml(query)}</span>
        </div>
        <div class="running-indicator">
          <span class="spinner"></span> Jev System One 推論中...
        </div>
      </div>
      <div class="stages-container" id="stages-flow">
        ${this.renderPlaceholderStages()}
      </div>
    `;
  }

  updateStage(record: PipelineStageRecord): void {
    const stageEl = document.getElementById(`stage-${record.stageId}`);
    if (!stageEl) return;

    stageEl.className = `stage-card status-${record.status} active`;
    stageEl.innerHTML = this.renderStageContent(record);
  }

  renderFinalResult(result: RagResult): void {
    const header = this.container.querySelector('.running-indicator');
    if (header) {
      header.innerHTML = `
        <span class="completed-badge">✓ 完了 (${result.totalLatencyMs}ms)</span>
      `;
    }

    // Add Answer Card at bottom
    const answerCard = document.createElement('div');
    answerCard.className = `final-answer-card ${result.isFallback ? 'is-fallback' : ''}`;
    answerCard.innerHTML = `
      <div class="answer-header">
        <div class="answer-title">
          <span class="badge">${result.isFallback ? '🛡️ 安全フォールバック' : '✨ 検証済み回答'}</span>
          <span class="attribution">引用忠実性: <strong>${result.attributionScore}%</strong></span>
          <span class="tokens-badge">トークン削減: <strong>${result.totalTokensSavedPercent}%</strong></span>
        </div>
        <div class="latency-pill">${result.totalLatencyMs} ms</div>
      </div>
      <div class="answer-body">
        <p class="answer-text">${this.formatAnswer(result.finalAnswer)}</p>
      </div>
      ${this.renderVerificationSection(result.verifiedClaims, result.rerankedPassages)}
    `;

    this.container.appendChild(answerCard);
  }

  private renderPlaceholderStages(): string {
    const stages = [
      { id: 'triage', name: 'Gate 1: Intent & Route Guard', desc: 'Jev Choice による即時トリアージ' },
      { id: 'retrieval', name: 'Stage 2: Hybrid Retrieval', desc: 'BM25 + 密ベクトルハイブリッド検索' },
      { id: 'rerank', name: 'Gate 3: Fast Reranking & Noise Filter', desc: 'Jev Score による高速ノイズ圧縮' },
      { id: 'sufficiency', name: 'Gate 4: Context Sufficiency Gate', desc: 'Jev Noul による回答十分性・ハルシネーション遮断' },
      { id: 'generation', name: 'System Two: LLM Generation', desc: '精選コンテキストによるグラウンデッド生成' },
      { id: 'verification', name: 'Gate 5: Faithfulness & Citation Guard', desc: 'Jev Noul による文単位の事実性裏付け検証' },
    ];

    return stages
      .map(
        (s, idx) => `
      <div class="stage-card status-pending" id="stage-${s.id}">
        <div class="stage-step">${idx + 1}</div>
        <div class="stage-main">
          <div class="stage-title">${s.name}</div>
          <div class="stage-desc">${s.desc}</div>
        </div>
        <div class="stage-badge">待機中</div>
      </div>
    `
      )
      .join('');
  }

  private renderStageContent(record: PipelineStageRecord): string {
    let detailsHtml = '';

    if (record.stageId === 'triage' && record.details.triage) {
      const t = record.details.triage;
      const probs = Object.entries(t.answer.probabilities || {})
        .map(([k, v]: [string, any]) => `<span class="prob-tag">${k}: <strong>${Math.round(v * 100)}%</strong></span>`)
        .join(' ');
      detailsHtml = `
        <div class="stage-metrics">
          <span class="metric-pill">Intent: <strong>${t.intent}</strong></span>
          <span class="metric-pill">Target: <strong>${t.targetCategory || '全カテゴリ'}</strong></span>
          <span class="metric-pill">Decompose: <strong>${t.needsDecomposition ? 'YES' : 'NO'}</strong></span>
        </div>
        <div class="prob-distribution">${probs}</div>
      `;
    } else if (record.stageId === 'rerank' && record.details.rerank) {
      const r = record.details.rerank;
      detailsHtml = `
        <div class="stage-metrics">
          <span class="metric-pill accepted">採択: <strong>${r.acceptedPassages.length} 件</strong></span>
          <span class="metric-pill rejected">除外: <strong>${r.rejectedCount} 件</strong></span>
          <span class="metric-pill highlight">トークン削減: <strong>${r.tokensSavedPercent}%</strong></span>
        </div>
        <div class="passages-mini-list">
          ${r.passages
            .map(
              (p: RerankedPassage) => `
            <div class="mini-passage ${p.isAccepted ? 'accepted' : 'rejected'}">
              <span class="score-badge">${p.relevanceScore.toFixed(2)} pts</span>
              <span class="doc-tag">${this.escapeHtml(p.chunk.docTitle)}</span>
              <span class="text-snippet">${this.escapeHtml(p.chunk.text.slice(0, 45))}...</span>
              <span class="decision-tag">${p.isAccepted ? '採用' : '足切り'}</span>
            </div>
          `
            )
            .join('')}
        </div>
      `;
    } else if (record.stageId === 'sufficiency' && record.details.sufficiency) {
      const s = record.details.sufficiency;
      detailsHtml = `
        <div class="stage-metrics">
          <span class="metric-pill ${s.isSufficient ? 'accepted' : 'rejected'}">
            十分性: <strong>${Math.round(s.sufficiencyScore * 100)}%</strong>
          </span>
          <span class="metric-desc">${s.isSufficient ? '客観的回答可能（LLMへ進む）' : '根拠不足（ハルシネーション防止のため早期終了）'}</span>
        </div>
      `;
    } else if (record.stageId === 'verification' && record.details.verification) {
      const v = record.details.verification;
      detailsHtml = `
        <div class="stage-metrics">
          <span class="metric-pill ${v.allPassed ? 'accepted' : 'warning'}">
            Attribution Score: <strong>${v.attributionScore}%</strong>
          </span>
          <span class="metric-desc">${v.allPassed ? '全主張が原文に100%裏付け' : '一部に裏付けのない文を検知'}</span>
        </div>
      `;
    }

    return `
      <div class="stage-header-row">
        <div class="stage-title-wrap">
          <span class="stage-name">${record.stageName}</span>
          <span class="stage-summary">${record.summary}</span>
        </div>
        <div class="stage-latency-tag">${record.latencyMs} ms</div>
      </div>
      ${detailsHtml}
    `;
  }

  private renderVerificationSection(claims: ClaimVerification[], passages: RerankedPassage[]): string {
    if (claims.length === 0 && passages.length === 0) return '';

    const claimsHtml = claims
      .map(
        (c) => `
      <div class="claim-item ${c.isSupported ? 'supported' : 'unsupported'}">
        <div class="claim-status-icon">${c.isSupported ? '✓' : '⚠️'}</div>
        <div class="claim-content">
          <div class="claim-text">${this.escapeHtml(c.claim)}</div>
          <div class="claim-meta">
            <span class="meta-noul">支持度 (Noul): <strong>${Math.round(c.supportScore * 100)}%</strong></span>
            ${c.sourceDocTitle ? `<span class="meta-source">引用元: ${this.escapeHtml(c.sourceDocTitle)}</span>` : ''}
            <span class="meta-label">${c.isSupported ? '事実性検証済' : 'ハルシネーション注意'}</span>
          </div>
        </div>
      </div>
    `
      )
      .join('');

    return `
      <div class="verification-details">
        <h4>文単位の引用・事実性検証 (Gate 5)</h4>
        <div class="claims-list">${claimsHtml}</div>
      </div>
    `;
  }

  private formatAnswer(text: string): string {
    return text.replace(/\n/g, '<br/>');
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
