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
  /**
   * 2〜10段階のレベル説明を「配列」で渡す（実APIの必須フィールド名は
   * legend ではなく criteria。以前はlegendという独自形式で送っており、
   * サーバー側のスキーマ検証で422 Unprocessable Entityになっていた）。
   * 配列のインデックス（0始まり）がそのままレスポンスscoreの尺度になる。
   */
  criteria: string[];
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
  /** レスポンスに付与される、criteria配列のインデックス→説明文の対応表 */
  legend?: Record<string, string>;
}

export interface NoulAnswer {
  type: "noul";
  noul: number;
}

export type JevAnswer = ChoiceAnswer | ScoreAnswer | NoulAnswer;

export interface JevSystemOneResponse {
  answers: Record<string, JevAnswer>;
}
