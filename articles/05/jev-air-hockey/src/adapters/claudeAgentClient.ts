/**
 * Anthropic Claude Agent Client (Clean Architecture - Adapter Layer)
 *
 * 公式SDKを dangerouslyAllowBrowser で使う。ローカルヒューリスティックによる
 * フォールバックは持たない — 失敗はそのまま計測対象の失敗として記録する。
 * 通信に失敗した局面は、作戦タイムに Claude 自身が立てた作戦で打つ。
 */

import Anthropic from "@anthropic-ai/sdk";
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
import { ModelSettings, supportsEffort } from "./modelSettings";
import { describeClaudeError, sanitizeApiKey } from "./apiKeyCheck";

export class ClaudeAgentClient implements IAgentClient {
  readonly type = AgentType.CLAUDE;
  readonly usesLiveApi = true;

  private readonly client: Anthropic | null;
  private readonly apiKey: string;

  constructor(options: { apiKey?: string } = {}) {
    const apiKey = sanitizeApiKey(
      options.apiKey ??
        (typeof window !== "undefined" ? localStorage.getItem("claude_api_key") ?? "" : "")
    );
    this.apiKey = apiKey;

    this.client = apiKey
      ? new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
      : null;
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
    if (!this.client) {
      return { ok: false, status: "ERROR", reason: "Claude APIキーが未設定です", latencyMs: 0 };
    }

    const started = performance.now();

    try {
      const model = ModelSettings.getClaudeModel();
      const response = await withTimeout(
        this.client.messages.create({
          model,
          max_tokens: 16000,
          output_config: {
            // effort を受け付けないモデル (Haiku 4.5) に送ると 400 になる
            ...(supportsEffort(model) ? { effort: ModelSettings.getEffort() } : {}),
            format: { type: "json_schema", schema: schema as Record<string, unknown> },
          },
          messages: [{ role: "user", content: prompt }],
        }),
        timeoutMs
      );

      const latencyMs = performance.now() - started;

      if (response.stop_reason === "refusal") {
        return { ok: false, status: "INVALID", reason: "モデルが応答を拒否しました", latencyMs };
      }
      if (response.stop_reason === "max_tokens") {
        return { ok: false, status: "INVALID", reason: "応答が max_tokens で打ち切られました", latencyMs };
      }

      const text = response.content.find(
        (block): block is Anthropic.TextBlock => block.type === "text"
      )?.text;

      if (!text) {
        return { ok: false, status: "INVALID", reason: "テキストブロックが含まれていません", latencyMs };
      }

      return { ok: true, raw: safeParse(text), latencyMs };
    } catch (e) {
      const latencyMs = performance.now() - started;
      if (isDecisionTimeout(e)) {
        return { ok: false, status: "TIMEOUT", reason: e.message, latencyMs };
      }
      return { ok: false, status: "ERROR", reason: describeClaudeError(e, this.apiKey), latencyMs };
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

