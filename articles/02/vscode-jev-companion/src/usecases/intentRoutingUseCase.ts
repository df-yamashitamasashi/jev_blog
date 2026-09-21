/**
 * Use Case 2: Intelligent Intent Routing
 * Classifies selected code into the most appropriate developer intent in milliseconds
 */

import {
  ChoiceAnswer,
  IntentRoutingResult,
  TargetIntentType,
} from "../domain/models";
import { PROMPT_TEMPLATES } from "../domain/constants";
import { IJevClient } from "../adapters/jevClient";
import { IJevConfig } from "../adapters/configAdapter";

export interface IntentRoutingRequest {
  selectedCode: string;
  contextBefore?: string;
  contextAfter?: string;
  languageId?: string;
}

export class IntentRoutingUseCase {
  constructor(
    private readonly jevClient: IJevClient,
    private readonly config: IJevConfig
  ) {}

  async execute(request: IntentRoutingRequest): Promise<IntentRoutingResult> {
    const state = {
      code: request.selectedCode,
      context_before: request.contextBefore ?? "",
      context_after: request.contextAfter ?? "",
      language: request.languageId ?? "typescript",
    };

    const response = await this.jevClient.systemOne({
      state,
      model: this.config.getModel(),
      questions: {
        recommended_action: {
          type: "choice",
          instructions:
            "Given this code snippet, which developer action is most urgently needed or appropriate?",
          criteria: {
            test_generation:
              "The code is a functional unit or utility without corresponding tests, ideal for unit test synthesis.",
            refactoring:
              "The code has high cyclomatic complexity, code smells, duplication, or mutable state that should be cleaned up.",
            documentation:
              "The code is public-facing API, function or class lacking adequate JSDoc/TSDoc or explanation.",
            bug_fixing:
              "The code exhibits logical flaws, potential null-pointer dereferences, off-by-one errors, or concurrency bugs.",
            security_hardening:
              "The code interacts with external input, network, or cryptographic primitives needing hardening.",
          },
        },
      },
    });

    const choiceAns = response.answers["recommended_action"] as ChoiceAnswer;
    if (!choiceAns || choiceAns.type !== "choice") {
      throw new Error("Invalid response from Jev for intent routing question");
    }

    const primaryIntent = choiceAns.choice as TargetIntentType;
    const confidence = choiceAns.confidence;
    const probabilities = choiceAns.probabilities as Record<TargetIntentType, number>;

    const promptTemplate =
      PROMPT_TEMPLATES[primaryIntent] ?? PROMPT_TEMPLATES.refactoring;

    // High complexity tasks (bug fixing, security) routed to System Two; doc/test to fast tier if confidence is high
    const targetModelTier =
      primaryIntent === "bug_fixing" || primaryIntent === "security_hardening"
        ? "system_two_reasoning"
        : confidence >= 0.85
        ? "fast_local"
        : "system_two_reasoning";

    return {
      primaryIntent,
      confidence,
      probabilities,
      recommendedPromptTemplate: promptTemplate,
      targetModelTier,
    };
  }
}
