/**
 * Rag Orchestrator: Combines all 5 Jev gates and System Two generator into a coherent pipeline.
 */

import { InMemoryRetriever } from '../adapters/inMemoryRetriever';
import { JevClient } from '../adapters/jevClient';
import { LLMClient } from '../adapters/llmClient';
import { BenchmarkComparison, PipelineStageRecord, RagResult } from '../domain/models';
import { PipelineEventCallback } from '../domain/pipelineEvents';
import { GeneratorUseCase } from './generatorUseCase';
import { AssessUseCase, SUFFICIENCY_THRESHOLD } from './assessUseCase';
import { TriageUseCase } from './triageUseCase';
import { VerificationUseCase } from './verificationUseCase';

const TOP_K = 5;

export class RagOrchestrator {
  private triageUseCase: TriageUseCase;
  private assessUseCase: AssessUseCase;
  private generatorUseCase: GeneratorUseCase;
  private verificationUseCase: VerificationUseCase;

  constructor(
    jevClient: JevClient,
    private llmClient: LLMClient,
    private retriever: InMemoryRetriever
  ) {
    this.triageUseCase = new TriageUseCase(jevClient);
    this.assessUseCase = new AssessUseCase(jevClient);
    this.generatorUseCase = new GeneratorUseCase(llmClient);
    this.verificationUseCase = new VerificationUseCase(jevClient);
  }

  async runPipeline(query: string, onEvent?: PipelineEventCallback): Promise<RagResult> {
    const pipelineStartTime = performance.now();
    const stages: PipelineStageRecord[] = [];

    const record = (r: PipelineStageRecord) => {
      stages.push(r);
      onEvent?.({ type: 'stage_complete', stageId: r.stageId, record: r });
    };
    const finish = (partial: Omit<RagResult, 'query' | 'totalLatencyMs' | 'stages'>): RagResult => {
      const result: RagResult = {
        query,
        totalLatencyMs: Math.round(performance.now() - pipelineStartTime),
        stages,
        ...partial,
      };
      onEvent?.({ type: 'pipeline_complete', data: result });
      return result;
    };

    // ==========================================
    // Gate 1 & 2: Intent Triage, Routing & Decomposition (one Jev call)
    // ==========================================
    onEvent?.({ type: 'stage_start', stageId: 'triage' });
    const triage = await this.triageUseCase.execute(query);

    record({
      stageId: 'triage',
      stageName: 'Gate 1 & 2: Intent Route Guard / Query Decomposition',
      status: 'passed',
      latencyMs: triage.latencyMs,
      summary: `インテント: ${triage.intent} (確信度: ${Math.round(triage.answer.confidence * 100)}%)`,
      details: { triage },
    });

    if (triage.intent === 'direct_answer') {
      return finish({
        finalAnswer: 'こんにちは！社内ナレッジや就業規程、API仕様についてお気軽にお尋ねください。',
        isDirectAnswer: true,
        isClarificationNeeded: false,
        isFallback: false,
        attributionScore: null,
        contextReductionPercent: null,
        llmTokensUsed: 0,
        rerankedPassages: [],
        verifiedClaims: [],
      });
    }

    if (triage.intent === 'clarification_needed') {
      return finish({
        finalAnswer:
          'ご質問の対象（社内規程、API仕様、解約手続きなど）が特定できませんでした。もう少し具体的にお聞かせいただけますか？',
        isDirectAnswer: false,
        isClarificationNeeded: true,
        isFallback: false,
        attributionScore: null,
        contextReductionPercent: null,
        llmTokensUsed: 0,
        rerankedPassages: [],
        verifiedClaims: [],
      });
    }

    // ==========================================
    // Retrieval: Hybrid search (sub-queries merged when Gate 2 decided to decompose)
    // ==========================================
    onEvent?.({ type: 'stage_start', stageId: 'retrieval' });
    const retrievalStart = performance.now();
    const searchResults = this.retriever.searchMany(triage.subQueries, TOP_K, triage.targetCategory);

    record({
      stageId: 'retrieval',
      stageName: 'Retrieval: Hybrid Search (BM25 + Dense)',
      status: 'passed',
      latencyMs: Math.round(performance.now() - retrievalStart),
      summary:
        triage.subQueries.length > 1
          ? `${triage.subQueries.length}件のクエリで検索し Top-${searchResults.length} 件を抽出`
          : `Top-${searchResults.length} 件の候補パッセージを抽出`,
      details: { count: searchResults.length, results: searchResults, subQueries: triage.subQueries },
    });

    // ==========================================
    // Gate 3 & 4: Relevance of every passage + sufficiency (one Jev call)
    // ==========================================
    onEvent?.({ type: 'stage_start', stageId: 'rerank' });
    const rerank = await this.assessUseCase.execute(query, searchResults);
    const sufficiency = rerank.sufficiency;

    record({
      stageId: 'rerank',
      stageName: 'Gate 3: Fast Reranking & Noise Filter',
      status: 'passed',
      latencyMs: rerank.latencyMs,
      summary: `精選: ${rerank.acceptedPassages.length}件採択 / ${rerank.rejectedCount}件除外 (コンテキスト${rerank.tokensSavedPercent}%削減)`,
      details: { rerank },
    });

    onEvent?.({ type: 'stage_start', stageId: 'sufficiency' });
    record({
      stageId: 'sufficiency',
      stageName: 'Gate 4: Context Sufficiency Gate（Gate 3 と同じ呼び出し）',
      status: sufficiency.isSufficient ? 'passed' : 'fallback',
      latencyMs: 0,
      summary: sufficiency.isSufficient
        ? `十分性スコア: ${Math.round(sufficiency.sufficiencyScore * 100)}% (合格)`
        : `十分性不足: ${Math.round(sufficiency.sufficiencyScore * 100)}% (早期終了)`,
      details: { sufficiency },
    });

    if (!sufficiency.isSufficient) {
      return finish({
        finalAnswer:
          '社内ナレッジベースおよび各種規程を確認しましたが、ご質問の内容に合致する客観的な根拠や情報は見当たりませんでした。（根拠がないため回答の生成をスキップしました）',
        isDirectAnswer: false,
        isClarificationNeeded: false,
        isFallback: true,
        fallbackReason: `Context Insufficient (Noul < ${SUFFICIENCY_THRESHOLD.toFixed(2)})`,
        attributionScore: null,
        contextReductionPercent: rerank.tokensSavedPercent,
        llmTokensUsed: 0,
        rerankedPassages: rerank.passages,
        verifiedClaims: [],
      });
    }

    // ==========================================
    // System Two: LLM Generation (called once)
    // ==========================================
    onEvent?.({ type: 'stage_start', stageId: 'generation' });
    const generation = await this.generatorUseCase.execute(query, rerank.acceptedPassages);

    record({
      stageId: 'generation',
      stageName: 'System Two: Grounded LLM Generation',
      status: 'passed',
      latencyMs: generation.latencyMs,
      summary: `回答生成完了 (${generation.claims.length}文・約${generation.tokensUsed}トークン)`,
      details: { generation },
    });

    // ==========================================
    // Gate 5: Faithfulness Verification
    // ==========================================
    onEvent?.({ type: 'stage_start', stageId: 'verification' });
    const verification = await this.verificationUseCase.execute(generation.claims, rerank.acceptedPassages);

    record({
      stageId: 'verification',
      stageName: 'Gate 5: Faithfulness & Citation Guard',
      status: verification.allPassed ? 'passed' : 'failed',
      latencyMs: verification.totalLatencyMs,
      summary: `引用裏付け率: ${verification.attributionScore}% (${verification.claims.filter((c) => c.isSupported).length}/${verification.claims.length}文合格)`,
      details: { verification },
    });

    return finish({
      finalAnswer: generation.content,
      isDirectAnswer: false,
      isClarificationNeeded: false,
      isFallback: false,
      attributionScore: verification.attributionScore,
      contextReductionPercent: rerank.tokensSavedPercent,
      llmTokensUsed: generation.tokensUsed,
      rerankedPassages: rerank.passages,
      verifiedClaims: verification.claims,
    });
  }

  /**
   * Compare Naive RAG (raw Top-K stuffed into the LLM, no gates) vs Jev Adaptive RAG.
   * Both paths use the same LLM client; hallucination is measured by running Gate 5 on the Naive answer
   * afterwards (not counted in Naive latency).
   */
  async runBenchmarkComparison(query: string): Promise<BenchmarkComparison> {
    const jevResult = await this.runPipeline(query);

    const naiveStartTime = performance.now();
    const rawChunks = this.retriever.search(query, TOP_K);
    const naiveContext = rawChunks.map((c) => `[${c.chunk.docTitle}]\n${c.chunk.text}`).join('\n\n');
    const naiveGen = await this.llmClient.generate({ query, context: naiveContext });
    const naiveLatency = Math.round(performance.now() - naiveStartTime);

    const naiveVerification = await this.verificationUseCase.execute(
      naiveGen.claims,
      rawChunks.map((c) => ({
        chunk: c.chunk,
        relevanceScore: 1.0,
        confidence: 1.0,
        scoreAnswer: { score: 1.0, confidence: 1.0 },
        isAccepted: true,
      }))
    );
    const naiveUnsupported = naiveVerification.claims.filter((c) => !c.isSupported).length;
    const jevUnsupported = jevResult.verifiedClaims.filter((c) => !c.isSupported).length;

    return {
      query,
      naiveRag: {
        answer: naiveGen.content,
        totalLatencyMs: naiveLatency,
        tokensUsed: naiveGen.tokensUsed,
        hallucinationDetected: naiveUnsupported > 0,
        unsupportedClaimCount: naiveUnsupported,
      },
      jevAdaptiveRag: {
        answer: jevResult.finalAnswer,
        totalLatencyMs: jevResult.totalLatencyMs,
        tokensUsed: jevResult.llmTokensUsed,
        hallucinationDetected: jevUnsupported > 0,
        unsupportedClaimCount: jevUnsupported,
        attributionScore: jevResult.attributionScore,
        isFallback: jevResult.isFallback,
        tokensSavedPercent:
          naiveGen.tokensUsed > 0 ? Math.round((1 - jevResult.llmTokensUsed / naiveGen.tokensUsed) * 100) : 0,
        latencyChangePercent:
          naiveLatency > 0 ? Math.round(((jevResult.totalLatencyMs - naiveLatency) / naiveLatency) * 100) : 0,
      },
    };
  }
}
