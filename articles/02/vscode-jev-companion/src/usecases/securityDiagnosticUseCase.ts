/**
 * Use Case 1: Real-time Code Security & Quality Diagnostic
 * Evaluates code snippets with Jev (Noul, Score, Choice) to emit confidence-gated diagnostics
 */

import {
  CodeSecurityDiagnostic,
  ChoiceAnswer,
  NoulAnswer,
  ScoreAnswer,
} from "../domain/models";
import { IJevClient } from "../adapters/jevClient";
import { IJevConfig } from "../adapters/configAdapter";

export interface DiagnosticEvaluationRequest {
  codeSnippet: string;
  filePath?: string;
  languageId?: string;
}

export class SecurityDiagnosticUseCase {
  constructor(
    private readonly jevClient: IJevClient,
    private readonly config: IJevConfig
  ) {}

  async execute(
    request: DiagnosticEvaluationRequest
  ): Promise<CodeSecurityDiagnostic[]> {
    if (!request.codeSnippet.trim()) {
      return [];
    }

    const state = {
      code: request.codeSnippet,
      language: request.languageId ?? "typescript",
      path: request.filePath ?? "untitled",
    };

    const response = await this.jevClient.systemOne({
      state,
      model: this.config.getModel(),
      questions: {
        is_risky: {
          type: "noul",
          instructions:
            "Does this code contain security vulnerabilities, hardcoded secrets, injection risks, or dangerous unhandled exceptions?",
        },
        risk_type: {
          type: "choice",
          instructions: "Identify the primary category of risk in this code.",
          criteria: {
            hardcoded_secret: "API keys, tokens, or passwords embedded in code",
            injection_risk: "Unsanitized user inputs passed to SQL, commands, or eval",
            unhandled_exception: "Silent error suppression, empty catch blocks, or dangerous fallbacks",
            safe: "No apparent security or critical quality risks found",
          },
        },
        risk_severity: {
          type: "score",
          instructions: "Score the severity of the risk from 1 (trivial/info) to 5 (critical security issue).",
        },
      },
    });

    const isRiskyAns = response.answers["is_risky"] as NoulAnswer | undefined;
    const riskTypeAns = response.answers["risk_type"] as ChoiceAnswer | undefined;
    const severityAns = response.answers["risk_severity"] as ScoreAnswer | undefined;

    if (!isRiskyAns || !riskTypeAns) {
      return [];
    }

    const threshold = this.config.getConfidenceThreshold();
    const riskProbability = isRiskyAns.noul;
    const riskChoice = riskTypeAns.choice;
    const confidence = riskTypeAns.confidence;

    // If judged safe or low probability, no diagnostic emitted
    if (riskChoice === "safe" || riskProbability < 0.6) {
      return [];
    }

    const isHighConfidence = confidence >= threshold;

    let highestSeverityScore = 3;
    if (severityAns && severityAns.score) {
      let maxProb = -1;
      for (const [scoreStr, prob] of Object.entries(severityAns.score)) {
        const num = Number(scoreStr);
        if (prob > maxProb) {
          maxProb = prob;
          highestSeverityScore = num;
        }
      }
    }

    const severityLevel =
      highestSeverityScore >= 4 ? "error" : highestSeverityScore === 3 ? "warning" : "info";

    let message = "";
    let suggestedFix: string | undefined;

    switch (riskChoice) {
      case "hardcoded_secret":
        message = `[Jev Security] Potential hardcoded credential or secret detected (Prob: ${(
          riskProbability * 100
        ).toFixed(1)}%, Conf: ${(confidence * 100).toFixed(1)}%)`;
        suggestedFix = "Extract credential into environment variable (e.g. process.env.API_KEY)";
        break;
      case "injection_risk":
        message = `[Jev Security] Potential injection or unsafe evaluation vulnerability (Prob: ${(
          riskProbability * 100
        ).toFixed(1)}%, Conf: ${(confidence * 100).toFixed(1)}%)`;
        suggestedFix = "Sanitize and parameterize query/command inputs";
        break;
      case "unhandled_exception":
        message = `[Jev Quality] Silent exception handling or unhandled error pattern (Prob: ${(
          riskProbability * 100
        ).toFixed(1)}%, Conf: ${(confidence * 100).toFixed(1)}%)`;
        suggestedFix = "Add proper error logging or recovery strategy";
        break;
      default:
        message = `[Jev Alert] Code quality risk identified: ${riskChoice}`;
    }

    return [
      {
        ruleId: `jev-${riskChoice}`,
        message,
        severity: severityLevel,
        confidence,
        probability: riskProbability,
        isHighConfidence,
        suggestedFix,
      },
    ];
  }
}
