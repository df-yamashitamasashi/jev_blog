/**
 * UseCase: Gate 3 - Fast Semantic Reranking & Noise Compression
 */

import { JevClient } from '../adapters/jevClient';
import { Score, ScoreAnswer } from '../domain/jevPrimitives';
import { RerankedPassage, SearchResult } from '../domain/models';

export interface RerankResult {
  passages: RerankedPassage[];
  acceptedPassages: RerankedPassage[];
  rejectedCount: number;
  tokensSavedPercent: number;
  totalLatencyMs: number;
}

export class RerankUseCase {
  constructor(private jevClient: JevClient) {}

  async execute(query: string, candidates: SearchResult[]): Promise<RerankResult> {
    if (candidates.length === 0) {
      return {
        passages: [],
        acceptedPassages: [],
        rejectedCount: 0,
        tokensSavedPercent: 0,
        totalLatencyMs: 0,
      };
    }

    const rerankedList: RerankedPassage[] = [];
    let totalLatency = 0;

    // Evaluate each candidate passage with Jev Score
    for (const item of candidates) {
      const question: Score = {
        instructions:
          '`passage` の内容は `query` の回答としてどれくらい有用・直接的な根拠を含んでいますか？',
        criteria: [
          '0: 無関係、トピックが異なる、または回答に役立つ情報がない',
          '1: 部分的に関連するが、周辺知識や背景情報に留まり直接的な回答には不足',
          '2: 非常に有用、質問に対する直接的な回答または明確な客観的事実が含まれている',
        ],
      };

      const response = await this.jevClient.systemOne({
        state: { query, passage: item.chunk.text },
        questions: { relevance: question },
      });

      totalLatency += response.latencyMs;
      const scoreAns = response.answers['relevance'] as ScoreAnswer;
      const score = scoreAns ? scoreAns.score : 0;
      const confidence = scoreAns ? scoreAns.confidence : 0.8;

      // Score threshold: >= 1.0 is accepted, < 1.0 is considered noise
      const isAccepted = score >= 1.0;

      rerankedList.push({
        chunk: item.chunk,
        relevanceScore: score,
        confidence,
        scoreAnswer: scoreAns,
        isAccepted,
      });
    }

    // Sort descending by relevanceScore
    rerankedList.sort((a, b) => b.relevanceScore - a.relevanceScore);

    const acceptedPassages = rerankedList.filter((p) => p.isAccepted);
    const rejectedCount = rerankedList.length - acceptedPassages.length;

    const initialChars = candidates.reduce((acc, c) => acc + c.chunk.text.length, 0);
    const acceptedChars = acceptedPassages.reduce((acc, p) => acc + p.chunk.text.length, 0);
    const tokensSavedPercent = initialChars > 0 ? Math.round(((initialChars - acceptedChars) / initialChars) * 100) : 0;

    return {
      passages: rerankedList,
      acceptedPassages,
      rejectedCount,
      tokensSavedPercent,
      totalLatencyMs: Math.round(totalLatency / candidates.length), // parallel batch latency in production
    };
  }
}
