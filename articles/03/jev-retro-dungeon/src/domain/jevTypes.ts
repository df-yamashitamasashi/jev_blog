/**
 * TypeSafe Jev (System One) Primitives & API Types
 * Clean Architecture - Domain Layer
 */

export type JevQuestionType = "choice" | "score" | "noul";

export interface ChoiceQuestionDefinition {
  type: "choice";
  instructions?: string;
  criteria: Record<string, string>;
}

export interface ScoreQuestionDefinition {
  type: "score";
  instructions?: string;
  legend: Record<string, string>;
}

export interface NoulQuestionDefinition {
  type: "noul";
  instructions?: string;
  criteria?: {
    true?: string;
    false?: string;
  };
}

export type JevQuestionDefinition =
  | ChoiceQuestionDefinition
  | ScoreQuestionDefinition
  | NoulQuestionDefinition;

export interface JevSystemOneRequest {
  state: string | Record<string, unknown>;
  model?: string;
  questions: Record<string, JevQuestionDefinition>;
}

export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface ScoreAnswer {
  type: "score";
  score: number;
  confidence: number;
  probabilities?: Record<string, number>;
}

export interface NoulAnswer {
  type: "noul";
  noul: number;
}

export type JevAnswer = ChoiceAnswer | ScoreAnswer | NoulAnswer;

export interface JevSystemOneResponse {
  answers: Record<string, JevAnswer>;
}
