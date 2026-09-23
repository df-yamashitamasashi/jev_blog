/**
 * TypeSafe Jev Agent Client (Clean Architecture - Adapter Layer)
 *
 * Jev System One は choice / score / noul の問いに答えるモデルなので、自由記述の
 * プロンプトとスキーマではなく、打ち返し計画を選択の組み合わせとして問う
 * ([[choiceQuestions]])。渡す盤面情報と軌道予測は Claude / Gemini と同じ。
 * フォールバックは持たない。
 *
 * api.typesafe.ai は Origin ホワイトリスト方式の CORS を敷いており、ブラウザから
 * 直接呼ぶと「Failed to fetch」になる。Vite のプロキシ (vite.config.ts の /jev-api)
 * を経由する。
 */

import { AgentType, AgentTelemetry } from "../domain/jevAgentTypes";
import { IAgentClient, AirHockeyObservation, PlaybookContext, PlaybookTelemetry } from "./agentClient";
import {
  DECISION_TIMEOUT_MS,
  PLAYBOOK_TIMEOUT_MS,
  StructuredCallResult,
  toTelemetry,
  failureTelemetry,
  toPlaybookTelemetry,
  playbookFailure,
  withTimeout,
  isDecisionTimeout,
} from "./llmShotPlanner";
import {
  QuestionSet,
  buildShotQuestions,
  buildPlaybookQuestions,
  answersToRawPlan,
  answersToRawPlaybook,
} from "./choiceQuestions";

/** ブラウザから直接呼ぶと CORS で弾かれるため、開発/プレビューサーバーのプロキシを使う */
const DEFAULT_JEV_BASE_URL = "/jev-api";

export class JevAgentClient implements IAgentClient {
  readonly type = AgentType.JEV;
  readonly usesLiveApi = true;

  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options: { apiKey?: string; baseUrl?: string } = {}) {
    this.apiKey =
      options.apiKey ??
      (typeof window !== "undefined" ? localStorage.getItem("jev_api_key") ?? "" : "");
    this.baseUrl = (options.baseUrl || DEFAULT_JEV_BASE_URL).replace(/\/+$/, "");
  }

  async decideShot(obs: AirHockeyObservation): Promise<AgentTelemetry> {
    const { request, contacts } = buildShotQuestions(obs);
    if (contacts.length === 0) {
      // 予測の地平線内にパックが自陣へ来ない。問うべき打点が無い
      return failureTelemetry("INVALID", "自陣での打点候補がありません", 0);
    }

    const result = await this.post(request, DECISION_TIMEOUT_MS);
    if (!result.ok) return failureTelemetry(result.status, result.reason, result.latencyMs);

    const raw = answersToRawPlan(result.raw, obs, contacts);
    if (!raw) {
      return failureTelemetry("INVALID", "応答に contact / aim / path の答えが揃っていません", result.latencyMs);
    }
    return toTelemetry(raw, obs, result.latencyMs);
  }

  /** 作戦タイム。問いが多いので2リクエストに分けて並列に投げ、答えを合わせる */
  async decidePlaybook(ctx: PlaybookContext): Promise<PlaybookTelemetry> {
    const results = await Promise.all(
      buildPlaybookQuestions(ctx).map((request) => this.post(request, PLAYBOOK_TIMEOUT_MS))
    );
    const latencyMs = Math.max(...results.map((r) => r.latencyMs));

    const failed = results.find((r) => !r.ok);
    if (failed && !failed.ok) return playbookFailure(failed.status, failed.reason, latencyMs);

    const answers = Object.assign({}, ...results.map((r) => (r.ok ? (r.raw as object) : {})));
    return toPlaybookTelemetry(answersToRawPlaybook(answers, ctx), ctx, latencyMs);
  }

  /** System One へ問いを投げ、answers を返す */
  private async post(request: QuestionSet, timeoutMs: number): Promise<StructuredCallResult> {
    if (!this.apiKey) {
      return { ok: false, status: "ERROR", reason: "Jev APIキーが未設定です", latencyMs: 0 };
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
          body: JSON.stringify(request),
        }),
        timeoutMs
      );

      const latencyMs = performance.now() - started;

      if (!res.ok) {
        return { ok: false, status: "ERROR", reason: `APIエラー ${res.status}${await readServerMessage(res)}`, latencyMs };
      }

      const data = await res.json();
      return { ok: true, raw: data?.answers ?? null, latencyMs };
    } catch (e) {
      const latencyMs = performance.now() - started;
      if (isDecisionTimeout(e)) {
        controller.abort();
        return { ok: false, status: "TIMEOUT", reason: e.message, latencyMs };
      }
      const message = e instanceof Error ? e.message : String(e);
      // fetch 自体が失敗した (応答が1バイトも返っていない)。CORS かネットワーク
      if (e instanceof TypeError) {
        return {
          ok: false,
          status: "ERROR",
          reason: `Jev APIへ接続できません (${message})。dev/preview サーバー経由で開いているか確認してください`,
          latencyMs,
        };
      }
      return { ok: false, status: "ERROR", reason: message, latencyMs };
    }
  }
}

/** サーバーが返す詳細メッセージ (例: APIキーの誤り) を、分かる範囲で添える */
async function readServerMessage(res: Response): Promise<string> {
  try {
    const body = await res.clone().json();
    const message = body?.detail?.message ?? body?.message ?? body?.error ?? body?.detail;
    return message ? ` - ${typeof message === "string" ? message : JSON.stringify(message)}` : "";
  } catch {
    try {
      const text = (await res.clone().text()).slice(0, 200);
      return text ? ` - ${text}` : "";
    } catch {
      return "";
    }
  }
}
