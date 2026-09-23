/**
 * TypeSafe AI - Jev (System One) Core Primitives
 *
 * - Choice: 選択肢の中から1つを選ぶ（各選択肢の確率つき）
 * - Score:  段階評価（0〜N）の期待値を返す
 * - Noul:   Yes/No 質問に対する「Yes の確率」を 0.0〜1.0 で返す
 */

export interface Choice {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string>;
}

export interface ChoiceAnswer {
  type?: 'choice';
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface Score {
  type: 'score';
  instructions: string;
  criteria: string[];
}

export interface ScoreAnswer {
  type?: 'score';
  score: number; // Expected value over the criteria levels (e.g. 0.0 - 2.0)
  probabilities?: number[] | Record<string, number>;
  confidence: number;
}

export interface Noul {
  type: 'noul';
  instructions: string;
}

export interface NoulAnswer {
  type?: 'noul';
  noul: number; // Probability of "Yes" [0.0, 1.0]
  confidence?: number;
}

export type JevQuestion = Choice | Score | Noul;
export type JevAnswer = ChoiceAnswer | ScoreAnswer | NoulAnswer;

export interface JevRequest {
  state: Record<string, any>;
  questions: Record<string, JevQuestion>;
}

export interface JevResponse {
  answers: Record<string, JevAnswer>;
  latencyMs: number;
  /** true when the answers came from the offline simulator instead of the TypeSafe API */
  isSimulated: boolean;
}
