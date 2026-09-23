/**
 * Application Entrypoint
 */

import { InMemoryRetriever } from '../adapters/inMemoryRetriever';
import { loadReplays, ReplayData, ReplayRecord, runFromReplay } from '../adapters/replayRepository';
import { runFromRagResult } from '../domain/trace';
import { RELEVANCE_THRESHOLD, SUFFICIENCY_THRESHOLD } from '../usecases/assessUseCase';
import { SUPPORT_THRESHOLD } from '../usecases/verificationUseCase';
import { JevClient } from '../adapters/jevClient';
import { LLMClient } from '../adapters/llmClient';
import { RagOrchestrator } from '../usecases/ragOrchestrator';
import { BenchmarkComparator } from './benchmarkComparator';
import { DocumentManager } from './documentManager';
import { FlowVisualizer } from './flowVisualizer';
import { PipelineVisualizer } from './pipelineVisualizer';
import { ReplayPanel } from './replayPanel';

const LIVE_THRESHOLDS = {
  relevance: RELEVANCE_THRESHOLD,
  sufficiency: SUFFICIENCY_THRESHOLD,
  support: SUPPORT_THRESHOLD,
};

export class App {
  private jevClient: JevClient;
  private llmClient: LLMClient;
  private retriever: InMemoryRetriever;
  private orchestrator: RagOrchestrator;
  public visualizer!: PipelineVisualizer;
  public docManager!: DocumentManager;
  public comparator!: BenchmarkComparator;
  public flow!: FlowVisualizer;
  private replays: ReplayData | null = null;

  constructor() {
    const savedJevKey = localStorage.getItem('TYPESAFE_API_KEY') || '';
    const savedOpenAiKey = localStorage.getItem('OPENAI_API_KEY') || '';

    this.jevClient = new JevClient(savedJevKey);
    this.llmClient = new LLMClient(savedOpenAiKey);
    this.retriever = new InMemoryRetriever();
    this.orchestrator = new RagOrchestrator(this.jevClient, this.llmClient, this.retriever);

    // APIキー設定済みなのに呼び出しに失敗した場合は、シミュレータで代替したことを明示する
    this.jevClient.onFallback = (info) => this.showFallbackBadge(`Jev API 呼び出し失敗（${info.reason}）→ シミュレータで代替中`);
    this.llmClient.onFallback = () => this.showFallbackBadge('LLM API 呼び出し失敗 → 生成シミュレータで代替中');
  }

  init(): void {
    // ?capture shows only the flow diagram, without animation (for screenshots)
    const params = new URLSearchParams(location.search);
    if (params.has('capture')) document.body.classList.add('capture');
    // ?still disables animation and auto-scroll (for full-page screenshots)
    if (params.has('still')) document.body.classList.add('still');

    this.visualizer = new PipelineVisualizer('pipeline-container');
    this.docManager = new DocumentManager('docs-container', this.retriever);
    this.comparator = new BenchmarkComparator('benchmark-container');
    this.flow = new FlowVisualizer('flow-container');
    const replayPanel = new ReplayPanel('replay-container', (r) => this.playReplay(r));

    this.bindEvents();
    this.updateKeyStatusBadges();

    loadReplays()
      .then((data) => {
        this.replays = data;
        replayPanel.render(data);
        // ?replay=t02 plays a recorded run on load (used for links and screenshots)
        const id = new URLSearchParams(location.search).get('replay');
        const record = id ? data.records.find((r) => r.id === id) : undefined;
        if (record) this.playReplay(record);
      })
      .catch((err) => replayPanel.showError(`記録を読み込めませんでした: ${err.message}`));
  }

  private playReplay(record: ReplayRecord): void {
    if (!this.replays) return;
    const { meta } = this.replays;
    this.flow.render(runFromReplay(record, meta), {
      kind: 'replay',
      label: `実測リプレイ：${meta.jevModel} + ${meta.generationModel}`,
    });
    this.visualizer.showReplayNote();
    const input = document.getElementById('query-input') as HTMLTextAreaElement | null;
    if (input) input.value = record.query;
    if (document.body.classList.contains('capture') || document.body.classList.contains('still')) {
      document.title = `capture-height:${document.body.scrollHeight}`;
    } else {
      document.getElementById('flow-container')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  private bindEvents(): void {
    const queryInput = document.getElementById('query-input') as HTMLInputElement;
    const btnRun = document.getElementById('btn-run-pipeline') as HTMLButtonElement;
    const btnBench = document.getElementById('btn-run-bench') as HTMLButtonElement;

    const run = async () => {
      const q = queryInput?.value.trim();
      if (!q) return;

      btnRun.disabled = true;
      this.visualizer.showRunning(q);

      try {
        const result = await this.orchestrator.runPipeline(q, (event) => {
          if (event.type === 'stage_complete' && event.record) {
            this.visualizer.updateStage(event.record);
          }
        });
        this.visualizer.renderFinalResult(result);
        this.flow.render(runFromRagResult(result, LIVE_THRESHOLDS), {
          kind: this.jevClient.hasApiKey() ? 'api' : 'simulator',
          label: this.jevClient.hasApiKey()
            ? 'ライブ実行：TypeSafe API'
            : 'ライブ実行：シミュレータ（簡易判定・精度の評価には使えません）',
        });
      } catch (err: any) {
        alert(`実行エラー: ${err.message}`);
      } finally {
        btnRun.disabled = false;
      }
    };

    btnRun?.addEventListener('click', run);
    queryInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        run();
      }
    });

    // Preset Queries
    document.querySelectorAll('.preset-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const q = btn.getAttribute('data-query');
        if (q && queryInput) {
          queryInput.value = q;
          run();
        }
      });
    });

    // A/B Benchmark Run
    btnBench?.addEventListener('click', async () => {
      const q = queryInput?.value.trim();
      if (!q) return;

      btnBench.disabled = true;
      this.comparator.showRunning();

      try {
        const bench = await this.orchestrator.runBenchmarkComparison(q);
        this.comparator.render(bench);
      } catch (err: any) {
        alert(`ベンチマークエラー: ${err.message}`);
      } finally {
        btnBench.disabled = false;
      }
    });

    // API Key Modal
    const modal = document.getElementById('api-key-modal');
    const btnOpenModal = document.getElementById('btn-open-settings');
    const btnCloseModal = document.getElementById('btn-close-modal');
    const btnSaveKeys = document.getElementById('btn-save-keys');
    const inputJevKey = document.getElementById('input-jev-key') as HTMLInputElement;
    const inputOpenAiKey = document.getElementById('input-openai-key') as HTMLInputElement;

    btnOpenModal?.addEventListener('click', () => {
      if (inputJevKey) inputJevKey.value = localStorage.getItem('TYPESAFE_API_KEY') || '';
      if (inputOpenAiKey) inputOpenAiKey.value = localStorage.getItem('OPENAI_API_KEY') || '';
      modal?.classList.remove('hidden');
    });

    btnCloseModal?.addEventListener('click', () => {
      modal?.classList.add('hidden');
    });

    btnSaveKeys?.addEventListener('click', () => {
      const jKey = inputJevKey?.value.trim() || '';
      const oKey = inputOpenAiKey?.value.trim() || '';

      localStorage.setItem('TYPESAFE_API_KEY', jKey);
      localStorage.setItem('OPENAI_API_KEY', oKey);
      this.jevClient.setApiKey(jKey);
      this.llmClient.setApiKey(oKey);

      modal?.classList.add('hidden');
      this.updateKeyStatusBadges();
    });
  }

  private updateKeyStatusBadges(): void {
    const badge = document.getElementById('status-api-badge');
    if (!badge) return;

    const jev = this.jevClient.hasApiKey() ? 'Jev: TypeSafe API' : 'Jev: シミュレータ';
    const llm = this.llmClient.hasApiKey() ? 'LLM: OpenAI API' : 'LLM: シミュレータ';
    const live = this.jevClient.hasApiKey() || this.llmClient.hasApiKey();
    badge.className = `status-indicator ${live ? 'live' : 'simulator'}`;
    badge.textContent = '';
    badge.insertAdjacentHTML('beforeend', '<span class="dot"></span>');
    badge.append(` ${jev} / ${llm}`);
  }

  private showFallbackBadge(message: string): void {
    const badge = document.getElementById('status-api-badge');
    if (!badge) return;
    badge.className = 'status-indicator fallback';
    badge.textContent = '';
    badge.insertAdjacentHTML('beforeend', '<span class="dot"></span>');
    badge.append(` ${message}`);
  }
}

// Bootstrap
document.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  app.init();
});
