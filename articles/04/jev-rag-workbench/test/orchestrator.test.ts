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
    expect(res.totalTokensSavedPercent).toBe(100);
  });

  it('should execute full 5-gate pipeline for factual knowledge queries', async () => {
    const res = await orchestrator.runPipeline('有給休暇の繰り越し上限は何日ですか？');
    expect(res.isDirectAnswer).toBe(false);
    expect(res.isFallback).toBe(false);
    expect(res.stages.length).toBe(6); // triage, retrieval, rerank, sufficiency, generation, verification
    expect(res.attributionScore).toBeGreaterThanOrEqual(80);
    expect(res.finalAnswer).toContain('20日');
  });

  it('should trigger early fallback on unknown queries to prevent hallucination', async () => {
    const res = await orchestrator.runPipeline('宇宙旅行手当の申請方法は？');
    expect(res.isFallback).toBe(true);
    expect(res.finalAnswer).toContain('客観的な根拠や情報');
    expect(res.verifiedClaims.length).toBe(0); // LLM generation and claim verification skipped
  });

  it('should run benchmark comparing Naive RAG vs Jev Adaptive RAG', async () => {
    const bench = await orchestrator.runBenchmarkComparison('有給休暇の繰り越し上限は何日ですか？');
    expect(bench.naiveRag).toBeDefined();
    expect(bench.jevAdaptiveRag).toBeDefined();
    expect(bench.jevAdaptiveRag.tokensSavedPercent).toBeGreaterThan(0);
  });
});
