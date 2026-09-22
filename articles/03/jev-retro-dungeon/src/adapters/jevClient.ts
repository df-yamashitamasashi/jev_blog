/**
 * TypeSafe Jev API Client & Fallback Simulator
 * Clean Architecture - Adapter Layer
 */

import {
  JevSystemOneRequest,
  JevSystemOneResponse,
  ChoiceAnswer,
  ScoreAnswer,
  NoulAnswer,
} from "../domain/jevTypes";
import { DEFAULT_JEV_BASE_URL, DEFAULT_JEV_MODEL } from "../domain/constants";

export interface IJevClient {
  systemOne(request: JevSystemOneRequest): Promise<{
    response: JevSystemOneResponse;
    latencyMs: number;
    isSimulated: boolean;
  }>;
}

export type JevFallbackReason = "timeout" | "http_error" | "network_error";

export interface JevFallbackInfo {
  reason: JevFallbackReason;
  detail: string;
}

export interface JevClientOptions {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  /**
   * APIキーが設定されているにもかかわらず実API呼び出しが失敗し、
   * シミュレーターへフォールバックした場合にのみ呼ばれる（キー未設定時の
   * 想定内フォールバックでは呼ばれない）。UI側で可視化するためのフック。
   */
  onFallback?: (info: JevFallbackInfo) => void;
}

export class JevClient implements IJevClient {
  private apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly onFallback?: (info: JevFallbackInfo) => void;

  constructor(options: JevClientOptions = {}) {
    this.apiKey = options.apiKey || (typeof window !== "undefined" ? localStorage.getItem("jev_api_key") || "" : "");
    this.baseUrl = (options.baseUrl || DEFAULT_JEV_BASE_URL).replace(/\/+$/, "");
    // Jev System OneはLLMバックエンドのため、特にモンスターDNA生成のような
    // 一度に8問を問い合わせる重いリクエストでは数秒かかることがある。
    // 短すぎるタイムアウトは正常なレスポンスすら打ち切ってしまうため、余裕を持たせる。
    this.timeoutMs = options.timeoutMs ?? 15000;
    this.onFallback = options.onFallback;
  }

  /** APIキーをその場で反映する（ページ再読み込み不要でLIVE呼び出しに切り替える） */
  setApiKey(apiKey: string): void {
    this.apiKey = apiKey.trim();
  }

  hasApiKey(): boolean {
    return this.apiKey.length > 0;
  }

  async systemOne(request: JevSystemOneRequest): Promise<{
    response: JevSystemOneResponse;
    latencyMs: number;
    isSimulated: boolean;
  }> {
    const startTime = performance.now();

    // API Keyが無い場合は即座にインテリジェント・シミュレーター（オフライン推論）にフォールバック
    if (!this.apiKey) {
      const simulated = this.simulateDecision(request);
      const latencyMs = Math.round(performance.now() - startTime + 60); // リアルな通信遅延を模倣
      return { response: simulated, latencyMs, isSimulated: true };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`${this.baseUrl}/v1/systemone`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        // TypeSafe API仕様上 state は string | object | array をそのまま受け付けるため、
        // 二重にJSON文字列化しない（以前はオブジェクトを文字列化して埋め込んでいた）
        body: JSON.stringify({
          state: request.state,
          model: request.model ?? DEFAULT_JEV_MODEL,
          questions: request.questions,
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        // サーバーが返す詳細メッセージ（例: 「APIキーを確認してください」）を
        // そのままログに出せるよう、可能な限り本文を読み取って添える
        let serverMessage = "";
        try {
          const body = await res.clone().json();
          serverMessage = body?.detail?.message || body?.message || body?.error || "";
        } catch {
          try {
            serverMessage = (await res.clone().text()).slice(0, 200);
          } catch {
            serverMessage = "";
          }
        }
        throw new Error(
          `Jev API HTTP error: ${res.status}${serverMessage ? ` - ${serverMessage}` : ""}`
        );
      }

      const json = (await res.json()) as JevSystemOneResponse;
      const latencyMs = Math.round(performance.now() - startTime);
      return { response: json, latencyMs, isSimulated: false };
    } catch (err) {
      clearTimeout(timer);
      const reason: JevFallbackReason =
        err instanceof DOMException && err.name === "AbortError"
          ? "timeout"
          : err instanceof Error && err.message.startsWith("Jev API HTTP error")
          ? "http_error"
          : "network_error";
      const detail = err instanceof Error ? err.message : String(err);
      console.warn("[JevClient] Falling back to intelligent simulator due to error:", err);
      // APIキーがあるのにLIVE呼び出しが失敗した場合のみ、UIへ通知する
      // （キー未設定時の想定内フォールバックは通知不要）
      this.onFallback?.({ reason, detail });
      const simulated = this.simulateDecision(request);
      const latencyMs = Math.round(performance.now() - startTime);
      return { response: simulated, latencyMs, isSimulated: true };
    }
  }

  /**
   * Jev System One の思考パターンを忠実に模倣したシミュレーションロジック
   * （オフライン動作時やデモ環境での完全なゲーム体験を保証）
   */
  private simulateDecision(request: JevSystemOneRequest): JevSystemOneResponse {
    const stateStr = typeof request.state === "string" ? request.state : JSON.stringify(request.state);
    let parsedState: Record<string, unknown> = {};
    try {
      parsedState = JSON.parse(stateStr);
    } catch {
      parsedState = {};
    }

    /**
     * stateのキー名は呼び出し側ごとに異なる（heroHpRatio / heroHpRemainingRatio /
     * monsterHpRatio、floor / floorNumber など）。
     * 単一のキー名だけを見るとどの呼び出しでも既定値に落ちてしまい、
     * スコアが常に同じ値を返す "効かないシミュレーター" になるため、
     * 同義のキーを順に探して最初に見つかった数値を採用する。
     */
    const pickNumber = (candidates: string[], fallback: number): number => {
      for (const key of candidates) {
        const v = parsedState[key];
        if (typeof v === "number" && Number.isFinite(v)) return v;
      }
      return fallback;
    };

    const hpRatio = pickNumber(["hpRatio", "heroHpRatio", "heroHpRemainingRatio"], 0.8);
    const floor = pickNumber(["floor", "floorNumber"], 1);
    const steps = pickNumber(["steps", "stepsTaken"], 0);
    const danger = pickNumber(["dangerScore"], 2.0);
    const kills = pickNumber(["consecutiveKills"], 0);

    const answers: Record<string, ChoiceAnswer | ScoreAnswer | NoulAnswer> = {};

    for (const [qKey, qDef] of Object.entries(request.questions)) {
      if (qDef.type === "choice") {
        const keys = Object.keys(qDef.criteria);
        // Stateの内容に応じてインテリジェントに選択
        let selectedKey = keys[0];

        if (keys.includes("safe_rest") && hpRatio < 0.3) {
          selectedKey = "safe_rest";
        } else if (keys.includes("boss") && floor % 5 === 0) {
          selectedKey = "boss";
        } else if (keys.includes("crimson") || keys.includes("frost") || keys.includes("shadow")) {
          // フロア属性: 浅い階層では通常属性も出す（従来は normal が一度も選ばれなかった）
          const elements = keys.filter((k) =>
            ["normal", "crimson", "frost", "shadow", "golden"].includes(k)
          );
          const pool = floor <= 2 ? elements : elements.filter((k) => k !== "normal");
          selectedKey = pool[Math.floor(Math.random() * pool.length)] || keys[0];
        } else {
          selectedKey = keys[Math.floor(Math.random() * keys.length)];
        }

        const probabilities: Record<string, number> = {};
        keys.forEach((k) => (probabilities[k] = k === selectedKey ? 0.75 : 0.25 / (keys.length - 1 || 1)));

        answers[qKey] = {
          type: "choice",
          choice: selectedKey,
          confidence: 0.88,
          probabilities,
        };
      } else if (qDef.type === "score") {
        // スコア（0.0 〜 4.0）: 階層が深いほど、また消耗しているほど高くなる
        const calcScore = Math.min(
          4.0,
          Math.max(0.5, 1.0 + (floor - 1) * 0.35 + kills * 0.4 + (1 - hpRatio) * 1.2)
        );
        answers[qKey] = {
          type: "score",
          score: Math.round(calcScore * 10) / 10,
          confidence: 0.92,
        };
      } else if (qDef.type === "noul") {
        // 奇襲確率：歩くほど、危険な階層ほど、また油断しているときに上昇
        const noulVal = Math.min(
          0.95,
          Math.max(0.1, 0.10 + steps * 0.05 + danger * 0.04 + kills * 0.05 + (hpRatio >= 0.8 ? 0.05 : 0))
        );
        answers[qKey] = {
          type: "noul",
          noul: Math.round(noulVal * 100) / 100,
        };
      }
    }

    return { answers };
  }
}
