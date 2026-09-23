/**
 * Replay Panel: pick a recorded run (real Jev + Gemini) and play it in the flow diagram.
 */

import { ReplayData, ReplayRecord } from '../adapters/replayRepository';

const GROUPS: { label: string; match: (r: ReplayRecord) => boolean }[] = [
  { label: '答えのある質問', match: (r) => r.split === 'test' && r.type === 'answerable' },
  { label: '複数の事柄を聞く質問', match: (r) => r.split === 'test' && r.type === 'compound' },
  { label: '惜しいけれど答えのない質問', match: (r) => r.split === 'test' && r.type === 'unanswerable' },
  { label: '閲覧権限のない文書にしか答えがない質問', match: (r) => r.split === 'test' && r.type === 'restricted' },
  { label: '挨拶・曖昧な入力', match: (r) => r.split === 'test' && (r.type === 'chitchat' || r.type === 'vague') },
  { label: '追加の10問（改善後に初めて実行）', match: (r) => r.split === 'holdout' },
  { label: '調整用（dev）', match: (r) => r.split === 'dev' },
];

// Runs worth showing first, with why they are interesting
export const FEATURED: { id: string; label: string }[] = [
  { id: 't02', label: '📋 正常に回答（有休の繰り越し）' },
  { id: 't35', label: '🛡️ 答えがない → LLM を呼ばない' },
  { id: 'd02', label: '🔍 Gate 5 が LLM の誤りを検出' },
  { id: 't30', label: '🧩 複合質問を分けて検索' },
  { id: 't55', label: '👋 挨拶は検索もしない' },
  { id: 't06', label: '⚠️ 取りこぼした例（夏休み）' },
];

const STATUS_MARK: Record<string, string> = { answered: '✓', no_answer: '🛡', direct: '💬', clarify: '❓' };

export class ReplayPanel {
  private container: HTMLElement;

  constructor(containerId: string, private onSelect: (record: ReplayRecord) => void) {
    const el = document.getElementById(containerId);
    if (!el) throw new Error(`Element #${containerId} not found`);
    this.container = el;
  }

  showError(message: string): void {
    this.container.innerHTML = `<div class="card-heading"><span>🎬 実測リプレイ</span></div><p class="replay-note">${message}</p>`;
  }

  render(data: ReplayData): void {
    const byId = new Map(data.records.map((r) => [r.id, r]));
    this.container.innerHTML = `
      <div class="card-heading">
        <span>🎬 実測リプレイ</span>
        <span class="counts-badge">${data.records.length}問</span>
      </div>
      <p class="replay-note">
        本物の Jev（${data.meta.jevModel}）と Gemini（${data.meta.generationModel}）で実行した記録です。
        API キーがなくても、実際に誰が何をしたかを図で確認できます。
      </p>
      <div class="presets-grid">
        ${FEATURED.filter((f) => byId.has(f.id))
          .map((f) => `<button class="preset-btn replay-btn" data-replay="${f.id}">${f.label}</button>`)
          .join('')}
      </div>
      <select id="replay-select" class="replay-select" aria-label="記録を選ぶ">
        <option value="">すべての記録から選ぶ…</option>
        ${GROUPS.map(
          (g) => `
          <optgroup label="${g.label}">
            ${data.records
              .filter(g.match)
              .map((r) => `<option value="${r.id}">${STATUS_MARK[r.status] ?? ''} ${r.id}: ${escapeHtml(r.query)}</option>`)
              .join('')}
          </optgroup>`
        ).join('')}
      </select>
    `;

    this.container.querySelectorAll<HTMLButtonElement>('[data-replay]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const r = byId.get(btn.dataset.replay!);
        if (r) this.onSelect(r);
      })
    );
    this.container.querySelector<HTMLSelectElement>('#replay-select')?.addEventListener('change', (e) => {
      const r = byId.get((e.target as HTMLSelectElement).value);
      if (r) this.onSelect(r);
    });
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
