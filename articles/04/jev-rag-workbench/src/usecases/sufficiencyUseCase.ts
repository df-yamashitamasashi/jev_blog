/**
 * UseCase: Gate 4 - Context Sufficiency & Hallucination Prevention Fallback
 */

import { JevClient } from '../adapters/jevClient';
import { Noul, NoulAnswer } from '../domain/jevPrimitives';
import { RerankedPassage, SufficiencyResult } from '../domain/models';

export class SufficiencyUseCase {
  constructor(private jevClient: JevClient) {}

  async execute(query: string, acceptedPassages: RerankedPassage[]): Promise<SufficiencyResult> {
    if (acceptedPassages.length === 0) {
      return {
        isSufficient: false,
        sufficiencyScore: 0.0,
        noulAnswer: { noul: 0.0, confidence: 0.99 },
        latencyMs: 0,
      };
    }

    const contextText = acceptedPassages.map((p, idx) => `[ドキュメント ${idx + 1}: ${p.chunk.docTitle}]\n${p.chunk.text}`).join('\n\n');

    const question: Noul = {
      instructions:
        '提供された `context` のみを参照して、`query` に対して客観的・事実に基づいた回答を作成することは十分に可能ですか？（コンテキストに直接的な回答や根拠が存在する場合に Yes と判定してください）',
    };

    const response = await this.jevClient.systemOne({
      state: { query, context: contextText },
      questions: { sufficiency: question },
    });

    const noulAns = response.answers['sufficiency'] as NoulAnswer;
    const score = noulAns ? noulAns.noul : 0.5;

    // Threshold: >= 0.70 means sufficient to formulate a factual answer
    const isSufficient = score >= 0.7;

    return {
      isSufficient,
      sufficiencyScore: score,
      noulAnswer: noulAns,
      latencyMs: response.latencyMs,
    };
  }
}
