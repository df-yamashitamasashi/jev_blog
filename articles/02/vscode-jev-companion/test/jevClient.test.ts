/**
 * Unit Tests for JevHttpClient
 */

import { describe, it, expect, vi } from "vitest";
import { JevHttpClient, JevApiError } from "../src/adapters/jevClient";
import { JevSystemOneResponse } from "../src/domain/models";

describe("JevHttpClient", () => {
  it("should throw JevApiError if API key is explicitly empty string even if env var exists", async () => {
    const mockFetch = vi.fn();
    const client = new JevHttpClient({
      apiKey: "",
      fetchFn: mockFetch as unknown as typeof fetch,
    });
    await expect(
      client.systemOne({
        state: "test code",
        questions: {
          test_q: { type: "noul", instructions: "is test?" },
        },
      })
    ).rejects.toThrow(JevApiError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("should fallback to TYPESAFE_API_KEY environment variable when apiKey option is undefined", async () => {
    const originalEnv = process.env.TYPESAFE_API_KEY;
    process.env.TYPESAFE_API_KEY = "env-injected-key";

    const mockResponseData: JevSystemOneResponse = {
      answers: { test_q: { type: "noul", noul: 0.8 } },
    };
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponseData,
    });

    try {
      const client = new JevHttpClient({
        fetchFn: mockFetch as unknown as typeof fetch,
      });
      const res = await client.systemOne({
        state: "test",
        questions: { test_q: { type: "noul" } },
      });
      expect(res.answers.test_q).toBeDefined();
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/v1/systemone"),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer env-injected-key",
          }),
        })
      );
    } finally {
      if (originalEnv !== undefined) {
        process.env.TYPESAFE_API_KEY = originalEnv;
      } else {
        delete process.env.TYPESAFE_API_KEY;
      }
    }
  });

  it("should successfully parse valid Jev API response", async () => {
    const mockResponseData: JevSystemOneResponse = {
      answers: {
        is_safe: {
          type: "noul",
          noul: 0.95,
        },
      },
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponseData,
    });

    const client = new JevHttpClient({
      apiKey: "test-api-key",
      baseUrl: "https://api.typesafe.ai",
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    const result = await client.systemOne({
      state: "const x = 1;",
      questions: {
        is_safe: { type: "noul" },
      },
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.answers.is_safe).toEqual({
      type: "noul",
      noul: 0.95,
    });
  });

  it("should throw JevApiError with status code on HTTP error", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      json: async () => ({ detail: "Invalid API Key" }),
    });

    const client = new JevHttpClient({
      apiKey: "bad-key",
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    await expect(
      client.systemOne({
        state: "code",
        questions: {},
      })
    ).rejects.toThrow(/401/);
  });
});
