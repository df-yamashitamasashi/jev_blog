/**
 * UseCase: Gate 5 - Faithfulness & Citation Verification
 */

import { JevClient } from '../adapters/jevClient';
import { Noul, NoulAnswer } from '../domain/jevPrimitives';
import { ClaimVerification, RerankedPassage } from '../domain/models';
import { coverage } from '../domain/textSimilarity';

// Yes 確率 0.85 以上の文だけを「裏付けあり」とする（誤って通すより、疑わしい文に警告を出す側に寄せる）
export const SUPPORT_THRESHOLD = 0.85;

export interface VerificationResult {
  claims: ClaimVerification[];
  attributionScore: number; // 0 - 100
  allPassed: boolean;
  totalLatencyMs: number;
}

const SUPPORT_QUESTION: Noul = {
  type: 'noul',
  instructions:
    '`claim` に書かれた主張や数値・条件は、`source` の文脈によって論理的かつ事実として客観的に裏付けられていますか？',
};

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

    const startTime = performance.now();
    const fullSourceText = passages.map((p) => p.chunk.text).join('\n');

    // Verify all claims in parallel (one Jev call per claim)
    const verifiedClaims: ClaimVerification[] = await Promise.all(
      claims.map(async (claim) => {
        const response = await this.jevClient.systemOne({
          state: { claim, source: fullSourceText },
          questions: { is_supported: SUPPORT_QUESTION },
        });
        const noulAns = response.answers['is_supported'] as NoulAnswer;
        const supportScore = noulAns ? noulAns.noul : 0;
        const isSupported = supportScore >= SUPPORT_THRESHOLD;

        // 引用元の表示用に、主張と最も重なりの大きいパッセージを紐づける
        const source = isSupported ? this.findBestPassage(claim, passages) : undefined;

        return {
          claim,
          sourceChunkId: source?.chunk.id,
          sourceDocTitle: source?.chunk.docTitle,
          isSupported,
          supportScore,
          noulAnswer: noulAns,
          latencyMs: response.latencyMs,
        };
      })
    );

    const passedCount = verifiedClaims.filter((c) => c.isSupported).length;

    return {
      claims: verifiedClaims,
      attributionScore: Math.round((passedCount / verifiedClaims.length) * 100),
      allPassed: passedCount === verifiedClaims.length,
      totalLatencyMs: Math.round(performance.now() - startTime),
    };
  }

  private findBestPassage(claim: string, passages: RerankedPassage[]): RerankedPassage | undefined {
    let best: RerankedPassage | undefined;
    let bestRatio = 0;
    for (const p of passages) {
      const ratio = coverage(claim, p.chunk.text);
      if (ratio > bestRatio) {
        best = p;
        bestRatio = ratio;
      }
    }
    return best;
  }
}
