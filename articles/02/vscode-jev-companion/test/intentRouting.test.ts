/**
 * Unit Tests for IntentRoutingUseCase
 */

import { describe, it, expect, vi } from "vitest";
import { IntentRoutingUseCase } from "../src/usecases/intentRoutingUseCase";
import { MockJevConfig } from "../src/adapters/configAdapter";
import { IJevClient } from "../src/adapters/jevClient";
import { JevSystemOneResponse } from "../src/domain/models";

describe("IntentRoutingUseCase", () => {
  it("should classify code into test_generation and route to fast tier on high confidence", async () => {
    const mockResponse: JevSystemOneResponse = {
      answers: {
        recommended_action: {
          type: "choice",
          choice: "test_generation",
          confidence: 0.94,
          probabilities: {
            test_generation: 0.94,
            refactoring: 0.03,
            documentation: 0.02,
            bug_fixing: 0.01,
            security_hardening: 0.0,
          },
        },
      },
    };

    const mockClient: IJevClient = {
      systemOne: vi.fn().mockResolvedValue(mockResponse),
    };
    const config = new MockJevConfig();
    const useCase = new IntentRoutingUseCase(mockClient, config);

    const result = await useCase.execute({
      selectedCode: "export function multiply(x: number, y: number): number { return x * y; }",
    });

    expect(result.primaryIntent).toBe("test_generation");
    expect(result.confidence).toBe(0.94);
    expect(result.targetModelTier).toBe("fast_local");
    expect(result.recommendedPromptTemplate).toContain("Generate comprehensive, production-grade unit tests");
  });

  it("should route bug_fixing to system_two_reasoning tier", async () => {
    const mockResponse: JevSystemOneResponse = {
      answers: {
        recommended_action: {
          type: "choice",
          choice: "bug_fixing",
          confidence: 0.88,
          probabilities: {
            bug_fixing: 0.88,
            refactoring: 0.08,
            test_generation: 0.02,
            documentation: 0.01,
            security_hardening: 0.01,
          },
        },
      },
    };

    const mockClient: IJevClient = {
      systemOne: vi.fn().mockResolvedValue(mockResponse),
    };
    const config = new MockJevConfig();
    const useCase = new IntentRoutingUseCase(mockClient, config);

    const result = await useCase.execute({
      selectedCode: "if (user.items[i].id == null) { process(user.items[i+1].name); }",
    });

    expect(result.primaryIntent).toBe("bug_fixing");
    expect(result.targetModelTier).toBe("system_two_reasoning");
    expect(result.recommendedPromptTemplate).toContain("principal debugging engineer");
  });
});
