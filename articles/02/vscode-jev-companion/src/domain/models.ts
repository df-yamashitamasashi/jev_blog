/**
 * TypeSafe Jev (System One) Domain Models & Primitive Types
 * Clean Architecture - Domain Layer (Pure TypeScript, No External Dependencies)
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
  score: Record<number, number>;
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

/**
 * Domain Entities
 */

export type DiagnosticSeverityLevel = "error" | "warning" | "info";

export interface CodeSecurityDiagnostic {
  ruleId: string;
  message: string;
  severity: DiagnosticSeverityLevel;
  confidence: number;
  probability: number;
  isHighConfidence: boolean;
  suggestedFix?: string;
}

export type TargetIntentType =
  | "test_generation"
  | "refactoring"
  | "documentation"
  | "bug_fixing"
  | "security_hardening";

export interface IntentRoutingResult {
  primaryIntent: TargetIntentType;
  confidence: number;
  probabilities: Record<TargetIntentType, number>;
  recommendedPromptTemplate: string;
  targetModelTier: "fast_local" | "system_two_reasoning";
}

export interface SpeculativeGateResult {
  shouldProceedToLLM: boolean;
  necessityScore: number;
  skipReason?: string;
}
