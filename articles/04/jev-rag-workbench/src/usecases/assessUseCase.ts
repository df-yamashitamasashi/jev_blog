/**
 * UseCase: Gate 3 (relevance of every passage) + Gate 4 (context sufficiency) in ONE Jev call.
 *
 * Jev bills by tokens, so asking several questions about one shared `state` is cheaper than
 * sending the same passages in separate calls — and it is one round trip instead of N + 1.
 */

import { JevClient } from '../adapters/jevClient';
import { JevQuestion, NoulAnswer, ScoreAnswer } from '../domain/jevPrimitives';
import { RerankedPassage, SearchResult, SufficiencyResult } from '../domain/models';

// Score の期待値が 1.0（「関連はするが直接の答えは含まない」）以上のパッセージだけを LLM に渡す
export const RELEVANCE_THRESHOLD = 1.0;
// Yes 確率 0.70 以上なら LLM 生成へ進む。上げるほど「答えない」寄り、下げるほど「答える」寄り
export const SUFFICIENCY_THRESHOLD = 0.7;

const RELEVANCE_CRITERIA = [
  '0: 無関係、または質問の答えに役立つ情報を含まない',
  '1: 関連はするが、質問への直接の答えは含まない',
  '2: 質問への直接の答え（数値・条件・手順など）を含む',
];

export interface AssessResult {
  passages: RerankedPassage[];
  acceptedPassages: RerankedPassage[];
  rejectedCount: number;
  tokensSavedPercent: number;
  sufficiency: SufficiencyResult;
  latencyMs: number;
}

export function displayText(p: { docTitle: string; text: string }): string {
  return `【${p.docTitle}】\n${p.text}`;
}

export class AssessUseCase {
  constructor(private jevClient: JevClient) {}

  async execute(query: string, candidates: SearchResult[]): Promise<AssessResult> {
    if (candidates.length === 0) {
      return {
        passages: [],
        acceptedPassages: [],
        rejectedCount: 0,
        tokensSavedPercent: 0,
        sufficiency: { isSufficient: false, sufficiencyScore: 0, noulAnswer: { noul: 0 }, latencyMs: 0 },
        latencyMs: 0,
      };
    }

    const state: Record<string, string> = { query };
    const questions: Record<string, JevQuestion> = {};
    candidates.forEach((c, i) => {
      const n = i + 1;
      state[`passage_${n}`] = displayText(c.chunk);
      questions[`relevance_${n}`] = {
        type: 'score',
        instructions: `\`passage_${n}\` は \`query\` の答えを含んでいますか？`,
        criteria: RELEVANCE_CRITERIA,
      };
    });
    questions.sufficient = {
      type: 'noul',
      instructions:
        `passage_1〜passage_${candidates.length} に書かれている内容だけで、\`query\` に正確に答えられますか？` +
        '推測や一般常識で補わないと答えられない場合は No としてください。',
    };

    const response = await this.jevClient.systemOne({ state, questions });

    const passages: RerankedPassage[] = candidates.map((c, i) => {
      const ans = response.answers[`relevance_${i + 1}`] as ScoreAnswer | undefined;
      const score = ans ? ans.score : 0;
      return {
        chunk: c.chunk,
        relevanceScore: score,
        confidence: ans ? ans.confidence : 0,
        scoreAnswer: ans ?? { score: 0, confidence: 0 },
        isAccepted: score >= RELEVANCE_THRESHOLD,
      };
    });
    passages.sort((a, b) => b.relevanceScore - a.relevanceScore);
    const acceptedPassages = passages.filter((p) => p.isAccepted);

    const initialChars = candidates.reduce((acc, c) => acc + c.chunk.text.length, 0);
    const acceptedChars = acceptedPassages.reduce((acc, p) => acc + p.chunk.text.length, 0);

    const noulAnswer = (response.answers.sufficient as NoulAnswer | undefined) ?? { noul: 0 };
    return {
      passages,
      acceptedPassages,
      rejectedCount: passages.length - acceptedPassages.length,
      tokensSavedPercent: initialChars > 0 ? Math.round(((initialChars - acceptedChars) / initialChars) * 100) : 0,
      sufficiency: {
        // 採用パッセージが1つもなければ、十分性の判定にかかわらず生成しない
        isSufficient: acceptedPassages.length > 0 && noulAnswer.noul >= SUFFICIENCY_THRESHOLD,
        sufficiencyScore: noulAnswer.noul,
        noulAnswer,
        latencyMs: 0,
      },
      latencyMs: response.latencyMs,
    };
  }
}
