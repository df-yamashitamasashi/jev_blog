/**
 * Unit Tests for SecurityDiagnosticUseCase
 */

import { describe, it, expect, vi } from "vitest";
import { SecurityDiagnosticUseCase } from "../src/usecases/securityDiagnosticUseCase";
import { MockJevConfig } from "../src/adapters/configAdapter";
import { IJevClient } from "../src/adapters/jevClient";
import { JevSystemOneResponse } from "../src/domain/models";

describe("SecurityDiagnosticUseCase", () => {
  it("should return empty array if code snippet is empty", async () => {
    const mockClient: IJevClient = {
      systemOne: vi.fn(),
    };
    const config = new MockJevConfig();
    const useCase = new SecurityDiagnosticUseCase(mockClient, config);

    const result = await useCase.execute({ codeSnippet: "   " });
    expect(result).toEqual([]);
    expect(mockClient.systemOne).not.toHaveBeenCalled();
  });

  it("should return empty array if code is judged safe", async () => {
    const mockResponse: JevSystemOneResponse = {
      answers: {
        is_risky: { type: "noul", noul: 0.1 },
        risk_type: {
          type: "choice",
          choice: "safe",
          confidence: 0.95,
          probabilities: { safe: 0.95, hardcoded_secret: 0.05 },
        },
        risk_severity: {
          type: "score",
          score: { 1: 0.9, 2: 0.1 },
          confidence: 0.9,
        },
      },
    };

    const mockClient: IJevClient = {
      systemOne: vi.fn().mockResolvedValue(mockResponse),
    };
    const config = new MockJevConfig();
    const useCase = new SecurityDiagnosticUseCase(mockClient, config);

    const result = await useCase.execute({
      codeSnippet: "export function add(a: number, b: number) { return a + b; }",
    });

    expect(result).toEqual([]);
  });

  it("should generate high-confidence security diagnostic for hardcoded secrets", async () => {
    const mockResponse: JevSystemOneResponse = {
      answers: {
        is_risky: { type: "noul", noul: 0.98 },
        risk_type: {
          type: "choice",
          choice: "hardcoded_secret",
          confidence: 0.92,
          probabilities: { hardcoded_secret: 0.92, safe: 0.08 },
        },
        risk_severity: {
          type: "score",
          score: { 1: 0.0, 2: 0.0, 3: 0.1, 4: 0.3, 5: 0.6 },
          confidence: 0.9,
        },
      },
    };

    const mockClient: IJevClient = {
      systemOne: vi.fn().mockResolvedValue(mockResponse),
    };
    const config = new MockJevConfig({ confidenceThreshold: 0.85 });
    const useCase = new SecurityDiagnosticUseCase(mockClient, config);

    const result = await useCase.execute({
      codeSnippet: 'const API_KEY = "sk-live-1234567890abcdef";',
    });

    expect(result).toHaveLength(1);
    const diag = result[0];
    expect(diag.ruleId).toBe("jev-hardcoded_secret");
    expect(diag.severity).toBe("error"); // score 5 -> error
    expect(diag.isHighConfidence).toBe(true);
    expect(diag.suggestedFix).toBeDefined();
    expect(diag.message).toContain("hardcoded credential");
  });
});
