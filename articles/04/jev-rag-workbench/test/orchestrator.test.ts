import { describe, expect, it } from 'vitest';
import { InMemoryRetriever } from '../src/adapters/inMemoryRetriever';
import { JevClient } from '../src/adapters/jevClient';
import { LLMClient } from '../src/adapters/llmClient';
import { RagOrchestrator } from '../src/usecases/ragOrchestrator';

describe('RagOrchestrator (End-to-End Pipeline)', () => {
  const jevClient = new JevClient();
  const llmClient = new LLMClient();
  const retriever = new InMemoryRetriever();
  const orchestrator = new RagOrchestrator(jevClient, llmClient, retriever);

  it('should immediately answer greetings without searching or calling LLM', async () => {
    const res = await orchestrator.runPipeline('こんにちは！');
    expect(res.isDirectAnswer).toBe(true);
    expect(res.stages.length).toBe(1);
    expect(res.stages[0].stageId).toBe('triage');
    expect(res.llmTokensUsed).toBe(0);
    expect(res.attributionScore).toBeNull();
  });

  it('should execute full 5-gate pipeline for factual knowledge queries', async () => {
    const res = await orchestrator.runPipeline('有給休暇の繰り越し上限は何日ですか？');
    expect(res.isDirectAnswer).toBe(false);
    expect(res.isFallback).toBe(false);
    expect(res.stages.length).toBe(6); // triage, retrieval, rerank, sufficiency, generation, verification
    expect(res.attributionScore).toBeGreaterThanOrEqual(80);
    expect(res.finalAnswer).toContain('20日');
    expect(res.verifiedClaims.every((c) => c.sourceChunkId)).toBe(true);
  });

  it('should answer from the retrieved document instead of a canned response', async () => {
    const res = await orchestrator.runPipeline('入社半年後に付与される有給休暇は何日ですか？');
    expect(res.isFallback).toBe(false);
    expect(res.finalAnswer).toContain('10日');
  });

  it('should search with sub-queries when Gate 2 decides to decompose', async () => {
    const res = await orchestrator.runPipeline('API認証トークンの有効期限とレート制限は？');
    const retrieval = res.stages.find((s) => s.stageId === 'retrieval')!;
    expect(retrieval.details.subQueries.length).toBeGreaterThan(1);
    expect(res.finalAnswer).toContain('24時間');
    expect(res.finalAnswer).toContain('60リクエスト');
  });

  it('should trigger early fallback on unknown queries to prevent hallucination', async () => {
    const res = await orchestrator.runPipeline('宇宙旅行手当の申請方法は？');
    expect(res.isFallback).toBe(true);
    expect(res.finalAnswer).toContain('客観的な根拠や情報');
    expect(res.verifiedClaims.length).toBe(0); // LLM generation and claim verification skipped
    expect(res.llmTokensUsed).toBe(0);
    expect(res.attributionScore).toBeNull();
  });

  it('should run benchmark comparing Naive RAG vs Jev Adaptive RAG', async () => {
    const bench = await orchestrator.runBenchmarkComparison('有給休暇の繰り越し上限は何日ですか？');
    expect(bench.naiveRag).toBeDefined();
    expect(bench.jevAdaptiveRag).toBeDefined();
    expect(bench.jevAdaptiveRag.tokensSavedPercent).toBeGreaterThan(0);
    expect(bench.naiveRag.hallucinationDetected).toBe(false);
  });

  it('should show Naive RAG fabricating an answer where Jev falls back', async () => {
    const bench = await orchestrator.runBenchmarkComparison('社内の宇宙旅行手当の申請方法は？');
    expect(bench.naiveRag.hallucinationDetected).toBe(true);
    expect(bench.jevAdaptiveRag.isFallback).toBe(true);
    expect(bench.jevAdaptiveRag.tokensUsed).toBe(0);
  });
});
