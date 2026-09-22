/**
 * Anthropic Claude Agent Client (Clean Architecture - Adapter Layer)
 *
 * 公式SDKを dangerouslyAllowBrowser で使う。ローカルヒューリスティックによる
 * フォールバックは持たない — 失敗はそのまま計測対象の失敗として記録する。
 */

import Anthropic from "@anthropic-ai/sdk";
import { AgentType, AgentTelemetry } from "../domain/jevAgentTypes";
import { IAgentClient, AirHockeyObservation } from "./agentClient";
import {
  SHOT_PLAN_SCHEMA,
  buildShotPlanPrompt,
  toTelemetry,
  failureTelemetry,
} from "./llmShotPlanner";
import { ModelSettings } from "./modelSettings";

export class ClaudeAgentClient implements IAgentClient {
  readonly type = AgentType.CLAUDE;
  readonly usesLiveApi = true;

  private readonly client: Anthropic | null;

  constructor(options: { apiKey?: string } = {}) {
    const apiKey =
      options.apiKey ??
      (typeof window !== "undefined" ? localStorage.getItem("claude_api_key") ?? "" : "");

    this.client = apiKey
      ? new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
      : null;
  }

  async decideShot(obs: AirHockeyObservation): Promise<AgentTelemetry> {
    if (!this.client) {
      return failureTelemetry("ERROR", "Claude APIキーが未設定です", 0);
    }

    const started = performance.now();

    try {
      const response = await this.client.messages.create({
        model: ModelSettings.getClaudeModel(),
        max_tokens: 16000,
        output_config: {
          effort: ModelSettings.getEffort(),
          format: { type: "json_schema", schema: SHOT_PLAN_SCHEMA },
        },
        messages: [{ role: "user", content: buildShotPlanPrompt(obs) }],
      });

      const latencyMs = performance.now() - started;

      if (response.stop_reason === "refusal") {
        return failureTelemetry("INVALID", "モデルが応答を拒否しました", latencyMs);
      }
      if (response.stop_reason === "max_tokens") {
        return failureTelemetry("INVALID", "応答が max_tokens で打ち切られました", latencyMs);
      }

      const text = response.content.find(
        (block): block is Anthropic.TextBlock => block.type === "text"
      )?.text;

      if (!text) {
        return failureTelemetry("INVALID", "テキストブロックが含まれていません", latencyMs);
      }

      return toTelemetry(safeParse(text), obs, latencyMs);
    } catch (e) {
      return failureTelemetry("ERROR", describeError(e), performance.now() - started);
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

function describeError(e: unknown): string {
  if (e instanceof Anthropic.RateLimitError) return "レート制限に達しました";
  if (e instanceof Anthropic.AuthenticationError) return "APIキーが無効です";
  if (e instanceof Anthropic.APIError) return `APIエラー ${e.status}: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}
