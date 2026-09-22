/**
 * TypeSafe Jev Agent Client (Clean Architecture - Adapter Layer)
 *
 * Claude / Gemini と完全に同一のプロンプト・同一のスキーマを渡す。
 * フォールバックは持たない。
 */

import { AgentType, AgentTelemetry } from "../domain/jevAgentTypes";
import { IAgentClient, AirHockeyObservation } from "./agentClient";
import {
  SHOT_PLAN_SCHEMA,
  buildShotPlanPrompt,
  toTelemetry,
  failureTelemetry,
  withTimeout,
  isDecisionTimeout,
} from "./llmShotPlanner";

export class JevAgentClient implements IAgentClient {
  readonly type = AgentType.JEV;
  readonly usesLiveApi = true;

  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options: { apiKey?: string; baseUrl?: string } = {}) {
    this.apiKey =
      options.apiKey ??
      (typeof window !== "undefined" ? localStorage.getItem("jev_api_key") ?? "" : "");
    this.baseUrl = (options.baseUrl || "https://api.typesafe.ai").replace(/\/+$/, "");
  }

  async decideShot(obs: AirHockeyObservation): Promise<AgentTelemetry> {
    if (!this.apiKey) {
      return failureTelemetry("ERROR", "Jev APIキーが未設定です", 0);
    }

    const started = performance.now();

    const controller = new AbortController();

    try {
      const res = await withTimeout(
        fetch(`${this.baseUrl}/v1/systemone`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          signal: controller.signal,
          body: JSON.stringify({
            model: "jev-latest",
            prompt: buildShotPlanPrompt(obs),
            responseSchema: SHOT_PLAN_SCHEMA,
          }),
        })
      );

      const latencyMs = performance.now() - started;

      if (!res.ok) {
        return failureTelemetry("ERROR", `APIエラー ${res.status}`, latencyMs);
      }

      const data = await res.json();
      // 応答本体が JSON 文字列でもオブジェクトでも受けられるようにする
      const payload = data.answers ?? data.output ?? data;
      const parsed = typeof payload === "string" ? safeParse(payload) : payload;

      return toTelemetry(parsed, obs, latencyMs);
    } catch (e) {
      const latencyMs = performance.now() - started;
      if (isDecisionTimeout(e)) {
        controller.abort();
        return failureTelemetry("TIMEOUT", e.message, latencyMs);
      }
      const message = e instanceof Error ? e.message : String(e);
      return failureTelemetry("ERROR", message, latencyMs);
    }
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
