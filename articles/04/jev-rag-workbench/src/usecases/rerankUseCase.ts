/**
 * UseCase: Gate 3 - Fast Semantic Reranking & Noise Compression
 */

import { JevClient } from '../adapters/jevClient';
import { Score, ScoreAnswer } from '../domain/jevPrimitives';
import { RerankedPassage, SearchResult } from '../domain/models';

// Score の期待値が 1.0（「部分的に関連」）以上のパッセージだけを LLM に渡す
export const RELEVANCE_THRESHOLD = 1.0;

export interface RerankResult {
  passages: RerankedPassage[];
  acceptedPassages: RerankedPassage[];
  rejectedCount: number;
  tokensSavedPercent: number;
  totalLatencyMs: number;
}

const RELEVANCE_QUESTION: Score = {
  type: 'score',
  instructions: '`passage` の内容は `query` の回答としてどれくらい有用・直接的な根拠を含んでいますか？',
  criteria: [
    '0: 無関係、トピックが異なる、または回答に役立つ情報がない',
    '1: 部分的に関連するが、周辺知識や背景情報に留まり直接的な回答には不足',
    '2: 非常に有用、質問に対する直接的な回答または明確な客観的事実が含まれている',
  ],
};

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

    const startTime = performance.now();

    // Evaluate all candidate passages in parallel (one Jev call per passage)
    const rerankedList: RerankedPassage[] = await Promise.all(
      candidates.map(async (item) => {
        const response = await this.jevClient.systemOne({
          state: { query, passage: item.chunk.text },
          questions: { relevance: RELEVANCE_QUESTION },
        });
        const scoreAns = response.answers['relevance'] as ScoreAnswer;
        const score = scoreAns ? scoreAns.score : 0;
        return {
          chunk: item.chunk,
          relevanceScore: score,
          confidence: scoreAns ? scoreAns.confidence : 0,
          scoreAnswer: scoreAns,
          isAccepted: score >= RELEVANCE_THRESHOLD,
        };
      })
    );

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
      totalLatencyMs: Math.round(performance.now() - startTime),
    };
  }
}
