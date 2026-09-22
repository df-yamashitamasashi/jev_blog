/**
 * Google Gemini Agent Client (Clean Architecture - Adapter Layer)
 *
 * responseSchema による構造化出力を使う。Claude 側と完全に同一のプロンプト・
 * 同一のスキーマを渡し、フォールバックは持たない。
 */

import { AgentType, AgentTelemetry } from "../domain/jevAgentTypes";
import { IAgentClient, AirHockeyObservation } from "./agentClient";
import {
  SHOT_PLAN_SCHEMA,
  buildShotPlanPrompt,
  toTelemetry,
  failureTelemetry,
} from "./llmShotPlanner";
import { ModelSettings } from "./modelSettings";

export class GeminiAgentClient implements IAgentClient {
  readonly type = AgentType.GEMINI;
  readonly usesLiveApi = true;

  private readonly apiKey: string;

  constructor(options: { apiKey?: string } = {}) {
    this.apiKey =
      options.apiKey ??
      (typeof window !== "undefined" ? localStorage.getItem("gemini_api_key") ?? "" : "");
  }

  async decideShot(obs: AirHockeyObservation): Promise<AgentTelemetry> {
    if (!this.apiKey) {
      return failureTelemetry("ERROR", "Gemini APIキーが未設定です", 0);
    }

    const started = performance.now();
    const model = ModelSettings.getGeminiModel();

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: buildShotPlanPrompt(obs) }] }],
            generationConfig: {
              temperature: 0.4,
              responseMimeType: "application/json",
              responseSchema: toGeminiSchema(SHOT_PLAN_SCHEMA),
            },
          }),
        }
      );

      const latencyMs = performance.now() - started;

      if (!res.ok) {
        return failureTelemetry("ERROR", `APIエラー ${res.status}`, latencyMs);
      }

      const data = await res.json();
      const text: string | undefined = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!text) {
        return failureTelemetry("INVALID", "応答にテキストが含まれていません", latencyMs);
      }

      return toTelemetry(safeParse(text), obs, latencyMs);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return failureTelemetry("ERROR", message, performance.now() - started);
    }
  }
}

/**
 * Gemini の responseSchema は additionalProperties を受け付けないため取り除く。
 * 構造そのものは Claude 側と同一に保つ。
 */
function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== "object") return schema;

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (key === "additionalProperties") continue;
    result[key] = toGeminiSchema(value);
  }
  return result;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
