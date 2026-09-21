/**
 * Unit Tests for SpeculativeGateUseCase
 */

import { describe, it, expect, vi } from "vitest";
import { SpeculativeGateUseCase } from "../src/usecases/speculativeGateUseCase";
import { MockJevConfig } from "../src/adapters/configAdapter";
import { IJevClient } from "../src/adapters/jevClient";
import { JevSystemOneResponse } from "../src/domain/models";

describe("SpeculativeGateUseCase", () => {
  it("should always proceed if gate is disabled in config", async () => {
    const mockClient: IJevClient = { systemOne: vi.fn() };
    const config = new MockJevConfig({ enableSpeculativeGate: false });
    const useCase = new SpeculativeGateUseCase(mockClient, config);

    const result = await useCase.execute({
      currentLine: "const a = 1;",
      surroundingSnippet: "const a = 1;",
      triggerKind: "typing",
    });

    expect(result.shouldProceedToLLM).toBe(true);
    expect(mockClient.systemOne).not.toHaveBeenCalled();
  });

  it("should skip LLM execution on empty line without calling Jev API", async () => {
    const mockClient: IJevClient = { systemOne: vi.fn() };
    const config = new MockJevConfig({ enableSpeculativeGate: true });
    const useCase = new SpeculativeGateUseCase(mockClient, config);

    const result = await useCase.execute({
      currentLine: "   ",
      surroundingSnippet: "function test() {\n   \n}",
      triggerKind: "typing",
    });

    expect(result.shouldProceedToLLM).toBe(false);
    expect(result.skipReason).toContain("empty or whitespace");
    expect(mockClient.systemOne).not.toHaveBeenCalled();
  });

  it("should gate LLM execution when Jev evaluates requires_deep_reasoning as low", async () => {
    const mockResponse: JevSystemOneResponse = {
      answers: {
        requires_deep_reasoning: {
          type: "noul",
          noul: 0.12, // Low necessity
        },
      },
    };

    const mockClient: IJevClient = {
      systemOne: vi.fn().mockResolvedValue(mockResponse),
    };
    const config = new MockJevConfig({ enableSpeculativeGate: true });
    const useCase = new SpeculativeGateUseCase(mockClient, config);

    const result = await useCase.execute({
      currentLine: "const PORT = 3000;",
      surroundingSnippet: "const PORT = 3000;",
      triggerKind: "save",
    });

    expect(result.shouldProceedToLLM).toBe(false);
    expect(result.necessityScore).toBe(0.12);
    expect(result.skipReason).toBeDefined();
  });

  it("should proceed to LLM when Jev evaluates high necessity", async () => {
    const mockResponse: JevSystemOneResponse = {
      answers: {
        requires_deep_reasoning: {
          type: "noul",
          noul: 0.91, // High necessity
        },
      },
    };

    const mockClient: IJevClient = {
      systemOne: vi.fn().mockResolvedValue(mockResponse),
    };
    const config = new MockJevConfig({ enableSpeculativeGate: true });
    const useCase = new SpeculativeGateUseCase(mockClient, config);

    const result = await useCase.execute({
      currentLine: "function solveTravelingSalesman(graph: Graph): Path {",
      surroundingSnippet: "function solveTravelingSalesman(graph: Graph): Path {",
      triggerKind: "typing",
    });

    expect(result.shouldProceedToLLM).toBe(true);
    expect(result.necessityScore).toBe(0.91);
    expect(result.skipReason).toBeUndefined();
  });
});
