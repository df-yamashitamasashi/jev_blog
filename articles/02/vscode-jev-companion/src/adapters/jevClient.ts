/**
 * TypeSafe Jev API Adapter
 * Handles low-level HTTP communication with the Jev System One endpoint
 */

import {
  JevSystemOneRequest,
  JevSystemOneResponse,
} from "../domain/models";
import {
  DEFAULT_JEV_BASE_URL,
  DEFAULT_JEV_MODEL,
  DEFAULT_REQUEST_TIMEOUT_MS,
} from "../domain/constants";

export interface IJevClient {
  systemOne(request: JevSystemOneRequest): Promise<JevSystemOneResponse>;
}

export interface JevClientOptions {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export class JevApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly responseBody?: unknown
  ) {
    super(message);
    this.name = "JevApiError";
  }
}

export class JevHttpClient implements IJevClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(options: JevClientOptions = {}) {
    this.apiKey =
      options.apiKey !== undefined
        ? options.apiKey
        : (typeof process !== "undefined" && process.env?.TYPESAFE_API_KEY) ||
          "";
    this.baseUrl = (options.baseUrl || DEFAULT_JEV_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async systemOne(request: JevSystemOneRequest): Promise<JevSystemOneResponse> {
    if (!this.apiKey) {
      throw new JevApiError(
        "TypeSafe API Key is not set. Please configure 'jev.apiKey' in VSCode settings or set TYPESAFE_API_KEY environment variable."
      );
    }

    const url = `${this.baseUrl}/v1/systemone`;
    const payload = {
      state: request.state,
      model: request.model ?? DEFAULT_JEV_MODEL,
      questions: request.questions,
    };

    const maxRetries = 1;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const res = await this.fetchFn(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        if (!res.ok) {
          let errorBody: unknown = null;
          let detailStr = "";
          try {
            errorBody = await res.json();
            if (errorBody && typeof errorBody === "object") {
              const eb = errorBody as Record<string, unknown>;
              if (eb.detail) {
                detailStr = `: ${typeof eb.detail === "string" ? eb.detail : JSON.stringify(eb.detail)}`;
              }
            }
          } catch {
            errorBody = await res.text().catch(() => null);
            if (typeof errorBody === "string" && errorBody.trim()) {
              detailStr = `: ${errorBody.slice(0, 200)}`;
            }
          }

          // Transient errors (503, 502, 504, 429) can be retried once
          if ([429, 502, 503, 504].includes(res.status) && attempt < maxRetries) {
            clearTimeout(timeoutId);
            await new Promise((r) => setTimeout(r, 600));
            continue;
          }

          let message = `Jev API request failed with status ${res.status}: ${res.statusText}${detailStr}`;
          if (res.status === 503) {
            message = `TypeSafe Jev API is temporarily busy or scaling (503 Service Unavailable). Please retry in a few seconds.${detailStr}`;
          } else if (res.status === 422) {
            message = `Jev API request validation failed (422 Unprocessable Entity)${detailStr}`;
          }

          throw new JevApiError(message, res.status, errorBody);
        }

        const json = (await res.json()) as JevSystemOneResponse;
        if (!json || typeof json !== "object" || !json.answers) {
          throw new JevApiError("Malformed response structure from Jev API", res.status, json);
        }

        return json;
      } catch (err: unknown) {
        if (err instanceof JevApiError) {
          throw err;
        }
        if (err instanceof Error && err.name === "AbortError") {
          lastError = new JevApiError(`Jev API request timed out after ${this.timeoutMs}ms`);
        } else {
          lastError = new JevApiError(
            `Failed to communicate with Jev API: ${err instanceof Error ? err.message : String(err)}`
          );
        }

        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }
        throw lastError;
      } finally {
        clearTimeout(timeoutId);
      }
    }

    throw lastError || new JevApiError("Jev API call failed unexpectedly");
  }
}
