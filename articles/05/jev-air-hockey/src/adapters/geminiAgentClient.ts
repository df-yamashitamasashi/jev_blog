/**
 * Google Gemini Agent Client (Clean Architecture - Adapter Layer)
 *
 * responseSchema による構造化出力を使う。Claude・Jev と同じ選択式の問いに答えさせ、
 * フォールバックは持たない。
 * 通信に失敗した局面は、作戦タイムに Gemini 自身が立てた作戦で打つ。
 */

import { AgentType, AgentTelemetry } from "../domain/jevAgentTypes";
import { IAgentClient, AirHockeyObservation, PlaybookContext, PlaybookTelemetry } from "./agentClient";
import {
  PLAYBOOK_TIMEOUT_MS,
  DECISION_TIMEOUT_MS,
  StructuredCallResult,
  withTimeout,
  isDecisionTimeout,
} from "./llmShotPlanner";
import {
  PLAYBOOK_CHOICE_SCHEMA,
  buildShotCall,
  buildPlaybookPrompt,
  shotTelemetryFromChoices,
  playbookTelemetryFromChoices,
} from "./llmChoiceProtocol";
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
    // Jev と同じ選択式の問いに答えさせる ([[llmChoiceProtocol]])
    const call = buildShotCall(obs);
    return shotTelemetryFromChoices(await this.call(call.prompt, call.schema, DECISION_TIMEOUT_MS), call, obs);
  }

  async decidePlaybook(ctx: PlaybookContext): Promise<PlaybookTelemetry> {
    return playbookTelemetryFromChoices(
      await this.call(buildPlaybookPrompt(ctx), PLAYBOOK_CHOICE_SCHEMA, PLAYBOOK_TIMEOUT_MS),
      ctx
    );
  }

  private async call(prompt: string, schema: object, timeoutMs: number): Promise<StructuredCallResult> {
    if (!this.apiKey) {
      return { ok: false, status: "ERROR", reason: "Gemini APIキーが未設定です", latencyMs: 0 };
    }

    const started = performance.now();
    const model = ModelSettings.getGeminiModel();
    const controller = new AbortController();

    try {
      const res = await withTimeout(
        fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: {
                temperature: 0.4,
                responseMimeType: "application/json",
                responseSchema: toGeminiSchema(schema),
              },
            }),
          }
        ),
        timeoutMs
      );

      const latencyMs = performance.now() - started;

      if (!res.ok) {
        let errorDetail = `APIエラー ${res.status}`;
        try {
          const errData = await res.json();
          if (errData?.error?.message) {
            errorDetail = `${res.status}: ${errData.error.message}`;
          }
        } catch {}
        console.error("Gemini API Error:", errorDetail);
        return { ok: false, status: "ERROR", reason: errorDetail, latencyMs };
      }

      const data = await res.json();
      const text: string | undefined = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!text) {
        return { ok: false, status: "INVALID", reason: "応答にテキストが含まれていません", latencyMs };
      }

      return { ok: true, raw: safeParse(text), latencyMs };
    } catch (e) {
      const latencyMs = performance.now() - started;
      if (isDecisionTimeout(e)) {
        controller.abort();
        return { ok: false, status: "TIMEOUT", reason: e.message, latencyMs };
      }
      const message = e instanceof Error ? e.message : String(e);
      return { ok: false, status: "ERROR", reason: message, latencyMs };
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
