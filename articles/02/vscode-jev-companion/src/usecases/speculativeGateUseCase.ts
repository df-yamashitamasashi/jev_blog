/**
 * Use Case 3: Speculative LLM Execution Gatekeeper
 * Evaluates whether an expensive LLM invocation is truly warranted for the current editor state
 */

import { NoulAnswer, SpeculativeGateResult } from "../domain/models";
import { IJevClient } from "../adapters/jevClient";
import { IJevConfig } from "../adapters/configAdapter";

export interface SpeculativeGateRequest {
  currentLine: string;
  surroundingSnippet: string;
  triggerKind: "typing" | "save" | "manual";
}

export class SpeculativeGateUseCase {
  constructor(
    private readonly jevClient: IJevClient,
    private readonly config: IJevConfig
  ) {}

  async execute(request: SpeculativeGateRequest): Promise<SpeculativeGateResult> {
    if (!this.config.isSpeculativeGateEnabled() || request.triggerKind === "manual") {
      return {
        shouldProceedToLLM: true,
        necessityScore: 1.0,
      };
    }

    // Trivial empty lines or comments do not need heavy LLM
    if (!request.currentLine.trim()) {
      return {
        shouldProceedToLLM: false,
        necessityScore: 0.0,
        skipReason: "Current line is empty or whitespace only.",
      };
    }

    const state = {
      line: request.currentLine,
      snippet: request.surroundingSnippet,
      trigger: request.triggerKind,
    };

    const response = await this.jevClient.systemOne({
      state,
      model: this.config.getModel(),
      questions: {
        requires_deep_reasoning: {
          type: "noul",
          instructions:
            "Does the developer's current change or cursor state require non-trivial semantic reasoning, complex logic completion, or deep architecture analysis from an LLM?",
        },
      },
    });

    const noulAns = response.answers["requires_deep_reasoning"] as NoulAnswer | undefined;
    if (!noulAns || noulAns.type !== "noul") {
      // Fallback safely to true if Jev decision fails
      return {
        shouldProceedToLLM: true,
        necessityScore: 0.5,
      };
    }

    const probability = noulAns.noul;
    const shouldProceed = probability >= 0.5;

    return {
      shouldProceedToLLM: shouldProceed,
      necessityScore: probability,
      skipReason: shouldProceed
        ? undefined
        : `Jev System One determined LLM reasoning is unnecessary for this edit (Necessity: ${(
            probability * 100
          ).toFixed(1)}%).`,
    };
  }
}
