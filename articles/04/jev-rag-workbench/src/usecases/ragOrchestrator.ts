/**
 * Rag Orchestrator: Combines all 5 Jev gates and System Two generator into a coherent pipeline.
 */

import { InMemoryRetriever } from '../adapters/inMemoryRetriever';
import { JevClient } from '../adapters/jevClient';
import { LLMClient } from '../adapters/llmClient';
import { BenchmarkComparison, PipelineStageRecord, RagResult } from '../domain/models';
import { PipelineEventCallback } from '../domain/pipelineEvents';
import { GeneratorUseCase } from './generatorUseCase';
import { RerankUseCase } from './rerankUseCase';
import { SufficiencyUseCase } from './sufficiencyUseCase';
import { TriageUseCase } from './triageUseCase';
import { VerificationUseCase } from './verificationUseCase';

export class RagOrchestrator {
  private triageUseCase: TriageUseCase;
  private rerankUseCase: RerankUseCase;
  private sufficiencyUseCase: SufficiencyUseCase;
  private generatorUseCase: GeneratorUseCase;
  private verificationUseCase: VerificationUseCase;

  constructor(
    jevClient: JevClient,
    private llmClient: LLMClient,
    private retriever: InMemoryRetriever
  ) {
    this.triageUseCase = new TriageUseCase(jevClient);
    this.rerankUseCase = new RerankUseCase(jevClient);
    this.sufficiencyUseCase = new SufficiencyUseCase(jevClient);
    this.generatorUseCase = new GeneratorUseCase(llmClient);
    this.verificationUseCase = new VerificationUseCase(jevClient);
  }

  async runPipeline(query: string, onEvent?: PipelineEventCallback): Promise<RagResult> {
    const pipelineStartTime = performance.now();
    const stages: PipelineStageRecord[] = [];

    // ==========================================
    // STAGE 1 & 2: Intent Triage & Decomposition
    // ==========================================
    onEvent?.({ type: 'stage_start', stageId: 'triage' });
    const triage = await this.triageUseCase.execute(query);

    const triageRecord: PipelineStageRecord = {
      stageId: 'triage',
      stageName: 'Gate 1: Intent & Route Guard',
      status: 'passed',
      latencyMs: triage.latencyMs,
      summary: `インテント: ${triage.intent} (確信度: ${Math.round(triage.answer.confidence * 100)}%)`,
      details: { triage },
    };
    stages.push(triageRecord);
    onEvent?.({ type: 'stage_complete', stageId: 'triage', record: triageRecord });

    // Handle early exit: Direct Answer (e.g. greetings)
    if (triage.intent === 'direct_answer') {
      const answer = 'こんにちは！社内ナレッジや就業規程、API仕様についてお気軽にお尋ねください。';
      return {
        query,
        finalAnswer: answer,
        isDirectAnswer: true,
        isClarificationNeeded: false,
        isFallback: false,
        attributionScore: 100,
        totalLatencyMs: Math.round(performance.now() - pipelineStartTime),
        totalTokensSavedPercent: 100,
        stages,
        rerankedPassages: [],
        verifiedClaims: [],
      };
    }

    // Handle early exit: Clarification Needed
    if (triage.intent === 'clarification_needed') {
      const answer =
        'ご質問の対象（社内規程、API仕様、解約手続きなど）が特定できませんでした。もう少し具体的にお聞かせいただけますか？';
      return {
        query,
        finalAnswer: answer,
        isDirectAnswer: false,
        isClarificationNeeded: true,
        isFallback: false,
        attributionScore: 100,
        totalLatencyMs: Math.round(performance.now() - pipelineStartTime),
        totalTokensSavedPercent: 100,
        stages,
        rerankedPassages: [],
        verifiedClaims: [],
      };
    }

    // ==========================================
    // STAGE 2: Hybrid Retrieval
    // ==========================================
    onEvent?.({ type: 'stage_start', stageId: 'retrieval' });
    const retrievalStart = performance.now();
    const searchResults = this.retriever.search(query, 5, triage.targetCategory);
    const retrievalLatency = Math.round(performance.now() - retrievalStart);

    const retrievalRecord: PipelineStageRecord = {
      stageId: 'retrieval',
      stageName: 'Stage 2: Hybrid Retrieval (BM25 + Dense)',
      status: 'passed',
      latencyMs: retrievalLatency,
      summary: `Top-${searchResults.length} 件の候補パッセージを抽出`,
      details: { count: searchResults.length, results: searchResults },
    };
    stages.push(retrievalRecord);
    onEvent?.({ type: 'stage_complete', stageId: 'retrieval', record: retrievalRecord });

    // ==========================================
    // STAGE 3: Semantic Reranker (Gate 3)
    // ==========================================
    onEvent?.({ type: 'stage_start', stageId: 'rerank' });
    const rerank = await this.rerankUseCase.execute(query, searchResults);

    const rerankRecord: PipelineStageRecord = {
      stageId: 'rerank',
      stageName: 'Gate 3: Fast Reranking & Noise Filter',
      status: 'passed',
      latencyMs: rerank.totalLatencyMs,
      summary: `精選: ${rerank.acceptedPassages.length}件採択 / ${rerank.rejectedCount}件除外 (トークン${rerank.tokensSavedPercent}%削減)`,
      details: { rerank },
    };
    stages.push(rerankRecord);
    onEvent?.({ type: 'stage_complete', stageId: 'rerank', record: rerankRecord });

    // ==========================================
    // STAGE 4: Context Sufficiency Gate (Gate 4)
    // ==========================================
    onEvent?.({ type: 'stage_start', stageId: 'sufficiency' });
    const sufficiency = await this.sufficiencyUseCase.execute(query, rerank.acceptedPassages);

    const sufficiencyRecord: PipelineStageRecord = {
      stageId: 'sufficiency',
      stageName: 'Gate 4: Context Sufficiency Gate',
      status: sufficiency.isSufficient ? 'passed' : 'fallback',
      latencyMs: sufficiency.latencyMs,
      summary: sufficiency.isSufficient
        ? `十分性スコア: ${Math.round(sufficiency.sufficiencyScore * 100)}% (合格)`
        : `十分性不足: ${Math.round(sufficiency.sufficiencyScore * 100)}% (早期終了)`,
      details: { sufficiency },
    };
    stages.push(sufficiencyRecord);
    onEvent?.({ type: 'stage_complete', stageId: 'sufficiency', record: sufficiencyRecord });

    // Handle early exit: Insufficient Context (Hallucination Prevention)
    if (!sufficiency.isSufficient) {
      const fallbackAnswer =
        '社内ナレッジベースおよび各種規程を確認しましたが、ご質問の内容に合致する客観的な根拠や情報は見当たりませんでした。（ハルシネーション防止のため生成をスキップしました）';
      return {
        query,
        finalAnswer: fallbackAnswer,
        isDirectAnswer: false,
        isClarificationNeeded: false,
        isFallback: true,
        fallbackReason: 'Context Insufficient (Noul < 0.70)',
        attributionScore: 100,
        totalLatencyMs: Math.round(performance.now() - pipelineStartTime),
        totalTokensSavedPercent: rerank.tokensSavedPercent,
        stages,
        rerankedPassages: rerank.passages,
        verifiedClaims: [],
      };
    }

    // ==========================================
    // STAGE 5: System Two LLM Generation
    // ==========================================
    onEvent?.({ type: 'stage_start', stageId: 'generation' });
    const generation = await this.generatorUseCase.execute(query, rerank.acceptedPassages);

    const generationRecord: PipelineStageRecord = {
      stageId: 'generation',
      stageName: 'System Two: Grounded LLM Generation',
      status: 'passed',
      latencyMs: generation.latencyMs,
      summary: `回答生成完了 (${generation.claims.length}文・約${generation.tokensUsed}トークン)`,
      details: { generation },
    };
    stages.push(generationRecord);
    onEvent?.({ type: 'stage_complete', stageId: 'generation', record: generationRecord });

    // ==========================================
    // STAGE 6: Faithfulness Verification (Gate 5)
    // ==========================================
    onEvent?.({ type: 'stage_start', stageId: 'verification' });
    const verification = await this.verificationUseCase.execute(
      generation.claims,
      rerank.acceptedPassages
    );

    const verificationRecord: PipelineStageRecord = {
      stageId: 'verification',
      stageName: 'Gate 5: Faithfulness & Citation Guard',
      status: verification.allPassed ? 'passed' : 'failed',
      latencyMs: verification.totalLatencyMs,
      summary: `引用裏付け率: ${verification.attributionScore}% (${verification.claims.filter((c) => c.isSupported).length}/${verification.claims.length}文合格)`,
      details: { verification },
    };
    stages.push(verificationRecord);
    onEvent?.({ type: 'stage_complete', stageId: 'verification', record: verificationRecord });

    const totalLatencyMs = Math.round(performance.now() - pipelineStartTime);

    const result: RagResult = {
      query,
      finalAnswer: generation.content,
      isDirectAnswer: false,
      isClarificationNeeded: false,
      isFallback: false,
      attributionScore: verification.attributionScore,
      totalLatencyMs,
      totalTokensSavedPercent: rerank.tokensSavedPercent,
      stages,
      rerankedPassages: rerank.passages,
      verifiedClaims: verification.claims,
    };

    onEvent?.({ type: 'pipeline_complete', data: result });
    return result;
  }

  /**
   * Compare Naive RAG (context stuffing with raw Top-K) vs Jev Adaptive RAG
   */
  async runBenchmarkComparison(query: string): Promise<BenchmarkComparison> {
    // 1. Run Jev Adaptive RAG
    const jevResult = await this.runPipeline(query);

    // 2. Simulate Naive RAG (all 5 chunks stuffed directly into LLM without reranking or sufficiency gate)
    const naiveStartTime = performance.now();
    const rawChunks = this.retriever.search(query, 5);
    const naiveContext = rawChunks.map((c) => c.chunk.text).join('\n\n');

    // In Naive RAG, simulate generation with potential hallucination
    const naiveGen = await this.llmClient.generate({
      query,
      context: naiveContext,
      simulateHallucination: true,
    });
    const naiveLatency = Math.round(performance.now() - naiveStartTime);

    // Check Naive RAG claims
    const naiveVerification = await this.verificationUseCase.execute(
      naiveGen.claims,
      rawChunks.map((c) => ({
        chunk: c.chunk,
        relevanceScore: 1.0,
        confidence: 0.8,
        scoreAnswer: { score: 1.0, confidence: 0.8 },
        isAccepted: true,
      }))
    );

    const unsupportedCount = naiveVerification.claims.filter((c) => !c.isSupported).length;

    const timeSavedPercent = naiveLatency > 0
      ? Math.max(0, Math.round(((naiveLatency - jevResult.totalLatencyMs) / naiveLatency) * 100))
      : 0;

    return {
      query,
      naiveRag: {
        answer: naiveGen.content,
        totalLatencyMs: naiveLatency,
        tokensUsed: naiveGen.tokensUsed,
        hallucinationDetected: unsupportedCount > 0,
        unsupportedClaimCount: unsupportedCount,
      },
      jevAdaptiveRag: {
        answer: jevResult.finalAnswer,
        totalLatencyMs: jevResult.totalLatencyMs,
        tokensUsed: Math.round(naiveGen.tokensUsed * (1 - jevResult.totalTokensSavedPercent / 100)),
        hallucinationDetected: jevResult.verifiedClaims.some((c) => !c.isSupported),
        unsupportedClaimCount: jevResult.verifiedClaims.filter((c) => !c.isSupported).length,
        attributionScore: jevResult.attributionScore,
        tokensSavedPercent: jevResult.totalTokensSavedPercent,
        timeSavedPercent,
      },
    };
  }
}
