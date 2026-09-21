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

export interface JevClientOptions {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export class JevClient implements IJevClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: JevClientOptions = {}) {
    this.apiKey = options.apiKey || (typeof window !== "undefined" ? localStorage.getItem("jev_api_key") || "" : "");
    this.baseUrl = (options.baseUrl || DEFAULT_JEV_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 2000;
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
        body: JSON.stringify({
          state: typeof request.state === "string" ? request.state : JSON.stringify(request.state),
          model: request.model ?? DEFAULT_JEV_MODEL,
          questions: request.questions,
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        throw new Error(`Jev API HTTP error: ${res.status}`);
      }

      const json = (await res.json()) as JevSystemOneResponse;
      const latencyMs = Math.round(performance.now() - startTime);
      return { response: json, latencyMs, isSimulated: false };
    } catch (err) {
      clearTimeout(timer);
      console.warn("[JevClient] Falling back to intelligent simulator due to error:", err);
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

    const answers: Record<string, ChoiceAnswer | ScoreAnswer | NoulAnswer> = {};

    for (const [qKey, qDef] of Object.entries(request.questions)) {
      if (qDef.type === "choice") {
        const keys = Object.keys(qDef.criteria);
        // Stateの内容に応じてインテリジェントに選択
        let selectedKey = keys[0];
        const hpRatio = typeof parsedState.hpRatio === "number" ? parsedState.hpRatio : 0.8;
        const floor = typeof parsedState.floor === "number" ? parsedState.floor : 1;

        if (keys.includes("safe_rest") && hpRatio < 0.3) {
          selectedKey = "safe_rest";
        } else if (keys.includes("boss") && floor % 5 === 0) {
          selectedKey = "boss";
        } else if (keys.includes("crimson") || keys.includes("frost") || keys.includes("shadow")) {
          const elements = keys.filter((k) => ["crimson", "frost", "shadow", "golden"].includes(k));
          selectedKey = elements[Math.floor(Math.random() * elements.length)] || keys[0];
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
        const hpRatio = typeof parsedState.hpRatio === "number" ? parsedState.hpRatio : 0.8;
        const kills = typeof parsedState.consecutiveKills === "number" ? parsedState.consecutiveKills : 0;
        // スコア（0.0 〜 4.0）
        const calcScore = Math.min(4.0, Math.max(0.5, 1.5 + kills * 0.4 - (1 - hpRatio)));
        answers[qKey] = {
          type: "score",
          score: Math.round(calcScore * 10) / 10,
          confidence: 0.92,
        };
      } else if (qDef.type === "noul") {
        const hpRatio = typeof parsedState.hpRatio === "number" ? parsedState.hpRatio : 0.8;
        const kills = typeof parsedState.consecutiveKills === "number" ? parsedState.consecutiveKills : 0;
        // 奇襲確率：キル数が高い、または油断しているときに上昇
        const noulVal = Math.min(0.95, Math.max(0.1, 0.3 + kills * 0.1 + (hpRatio > 0.8 ? 0.2 : 0)));
        answers[qKey] = {
          type: "noul",
          noul: Math.round(noulVal * 100) / 100,
        };
      }
    }

    return { answers };
  }
}
