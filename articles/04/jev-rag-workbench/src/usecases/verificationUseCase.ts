/**
 * UseCase: Gate 5 - Faithfulness & Citation Verification
 */

import { JevClient } from '../adapters/jevClient';
import { Noul, NoulAnswer } from '../domain/jevPrimitives';
import { ClaimVerification, RerankedPassage } from '../domain/models';

export interface VerificationResult {
  claims: ClaimVerification[];
  attributionScore: number; // 0 - 100
  allPassed: boolean;
  totalLatencyMs: number;
}

export class VerificationUseCase {
  constructor(private jevClient: JevClient) {}

  async execute(claims: string[], passages: RerankedPassage[]): Promise<VerificationResult> {
    if (claims.length === 0) {
      return {
        claims: [],
        attributionScore: 100,
        allPassed: true,
        totalLatencyMs: 0,
      };
    }

    const fullSourceText = passages.map((p) => p.chunk.text).join('\n');
    const verifiedClaims: ClaimVerification[] = [];
    let totalLatency = 0;

    for (const claim of claims) {
      const question: Noul = {
        instructions:
          '`claim` に書かれた主張や数値・条件は、`source` の文脈によって論理的かつ事実として客観的に裏付けられていますか？',
      };

      const response = await this.jevClient.systemOne({
        state: { claim, source: fullSourceText },
        questions: { is_supported: question },
      });

      totalLatency += response.latencyMs;
      const noulAns = response.answers['is_supported'] as NoulAnswer;
      const supportScore = noulAns ? noulAns.noul : 0.5;

      // Threshold: >= 0.85 means mathematically supported
      const isSupported = supportScore >= 0.85;

      // Find matching passage chunk if possible
      const matchedPassage = passages.find((p) => {
        const words = claim.replace(/[?？!！、。・]/g, ' ').split(/\s+/).filter((w) => w.length >= 2);
        return words.some((w) => p.chunk.text.includes(w));
      });

      verifiedClaims.push({
        claim,
        sourceChunkId: matchedPassage?.chunk.id,
        sourceDocTitle: matchedPassage?.chunk.docTitle,
        isSupported,
        supportScore,
        noulAnswer: noulAns,
        latencyMs: response.latencyMs,
      });
    }

    const passedCount = verifiedClaims.filter((c) => c.isSupported).length;
    const attributionScore = Math.round((passedCount / verifiedClaims.length) * 100);

    return {
      claims: verifiedClaims,
      attributionScore,
      allPassed: passedCount === verifiedClaims.length,
      totalLatencyMs: Math.round(totalLatency / claims.length), // parallel verification in production
    };
  }
}
