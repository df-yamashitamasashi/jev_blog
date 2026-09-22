/**
 * TypeSafe AI - Jev (System One) Core Primitives
 */

export interface Choice {
  instructions: string;
  criteria: Record<string, string>;
}

export interface ChoiceAnswer {
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface Score {
  instructions: string;
  criteria: string[];
}

export interface ScoreAnswer {
  score: number;
  probabilities?: number[];
  confidence: number;
}

export interface Noul {
  instructions: string;
}

export interface NoulAnswer {
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
}
