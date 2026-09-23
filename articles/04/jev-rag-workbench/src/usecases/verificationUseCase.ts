/**
 * UseCase: Gate 5 - Faithfulness & Citation Verification (all sentences in ONE Jev call)
 */

import { JevClient } from '../adapters/jevClient';
import { JevQuestion, NoulAnswer } from '../domain/jevPrimitives';
import { ClaimVerification, RerankedPassage } from '../domain/models';
import { coverage } from '../domain/textSimilarity';
import { displayText } from './assessUseCase';

// Yes 確率 0.80 以上の文を「裏付けあり」とする（実測では、根拠のない文は 0.25 以下、正しい文は 0.82 以上だった）
export const SUPPORT_THRESHOLD = 0.8;

// 「資料に記載がありません」のような文は事実の主張ではないので検証しない
export const NO_INFO_PATTERN = /(記載|記述|情報)が(ありません|見当たりません|ございません)|記載されていません/;

export interface VerificationResult {
  claims: ClaimVerification[];
  attributionScore: number; // 0 - 100
  allPassed: boolean;
  totalLatencyMs: number;
}

export class VerificationUseCase {
  constructor(private jevClient: JevClient) {}

  async execute(claims: string[], passages: RerankedPassage[]): Promise<VerificationResult> {
    const factual = claims.filter((c) => !NO_INFO_PATTERN.test(c));
    if (factual.length === 0) {
      return { claims: [], attributionScore: 100, allPassed: true, totalLatencyMs: 0 };
    }

    const state: Record<string, string> = {
      source: passages.map((p) => displayText(p.chunk)).join('\n\n'),
    };
    const questions: Record<string, JevQuestion> = {};
    factual.forEach((claim, i) => {
      const n = i + 1;
      state[`claim_${n}`] = claim;
      questions[`supported_${n}`] = {
        type: 'noul',
        instructions: `\`claim_${n}\` の内容（数値・条件・対象を含む）は、\`source\` に書かれていることだけで裏付けられますか？`,
      };
    });

    const response = await this.jevClient.systemOne({ state, questions });

    const verifiedClaims: ClaimVerification[] = factual.map((claim, i) => {
      const noulAns = (response.answers[`supported_${i + 1}`] as NoulAnswer | undefined) ?? { noul: 0 };
      const isSupported = noulAns.noul >= SUPPORT_THRESHOLD;
      // 引用元の表示用に、主張と最も重なりの大きいパッセージを紐づける
      const source = isSupported ? this.findBestPassage(claim, passages) : undefined;
      return {
        claim,
        sourceChunkId: source?.chunk.id,
        sourceDocTitle: source?.chunk.docTitle,
        isSupported,
        supportScore: noulAns.noul,
        noulAnswer: noulAns,
        latencyMs: response.latencyMs,
      };
    });

    const passedCount = verifiedClaims.filter((c) => c.isSupported).length;
    return {
      claims: verifiedClaims,
      attributionScore: Math.round((passedCount / verifiedClaims.length) * 100),
      allPassed: passedCount === verifiedClaims.length,
      totalLatencyMs: response.latencyMs,
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
