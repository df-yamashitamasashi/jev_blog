/**
 * Domain Models for Jev Adaptive RAG Pipeline
 */

import { ChoiceAnswer, ScoreAnswer, NoulAnswer } from './jevPrimitives';

export interface KnowledgeDocument {
  id: string;
  title: string;
  category: 'hr' | 'api' | 'faq' | 'custom';
  content: string;
  metadata?: Record<string, any>;
}

export interface DocumentChunk {
  id: string;
  docId: string;
  docTitle: string;
  category: string;
  text: string;
  embedding?: number[];
}

export type TriageIntent = 'direct_answer' | 'knowledge_search' | 'clarification_needed';

export interface QueryTriageResult {
  intent: TriageIntent;
  targetCategory?: string;
  answer: ChoiceAnswer;
  routeAnswer?: ChoiceAnswer;
  needsDecomposition: boolean;
  decompositionNoul?: NoulAnswer;
  subQueries: string[];
  latencyMs: number;
}

export interface SearchResult {
  chunk: DocumentChunk;
  bm25Score: number;
  denseScore: number; // pseudo-dense similarity in this demo (see InMemoryRetriever)
  hybridScore: number;
}

export interface RerankedPassage {
  chunk: DocumentChunk;
  relevanceScore: number; // 0.0 - 2.0
  confidence: number;
  scoreAnswer: ScoreAnswer;
  isAccepted: boolean;
}

export interface SufficiencyResult {
  isSufficient: boolean;
  sufficiencyScore: number; // 0.0 - 1.0 (Noul)
  noulAnswer: NoulAnswer;
  latencyMs: number;
}

export interface ClaimVerification {
  claim: string;
  sourceChunkId?: string;
  sourceDocTitle?: string;
  isSupported: boolean;
  supportScore: number; // 0.0 - 1.0 (Noul)
  noulAnswer: NoulAnswer;
  latencyMs: number;
}

export interface PipelineStageRecord {
  stageId: 'triage' | 'retrieval' | 'rerank' | 'sufficiency' | 'generation' | 'verification';
  stageName: string;
  status: 'passed' | 'skipped' | 'fallback' | 'failed';
  latencyMs: number;
  summary: string;
  details: Record<string, any>;
}

export interface RagResult {
  query: string;
  finalAnswer: string;
  isDirectAnswer: boolean;
  isClarificationNeeded: boolean;
  isFallback: boolean;
  fallbackReason?: string;
  attributionScore: number | null; // Percentage of verified claims [0, 100]; null when no LLM answer was generated
  totalLatencyMs: number;
  contextReductionPercent: number | null; // Context chars removed by Gate 3; null when retrieval was skipped
  llmTokensUsed: number; // 0 when the LLM was never called
  stages: PipelineStageRecord[];
  rerankedPassages: RerankedPassage[];
  verifiedClaims: ClaimVerification[];
}

export interface BenchmarkComparison {
  query: string;
  naiveRag: {
    answer: string;
    totalLatencyMs: number;
    tokensUsed: number;
    hallucinationDetected: boolean;
    unsupportedClaimCount: number;
  };
  jevAdaptiveRag: {
    answer: string;
    totalLatencyMs: number;
    tokensUsed: number;
    hallucinationDetected: boolean;
    unsupportedClaimCount: number;
    attributionScore: number | null;
    isFallback: boolean;
    tokensSavedPercent: number; // LLM tokens saved vs Naive RAG
    latencyChangePercent: number; // negative = faster than Naive RAG
  };
}
