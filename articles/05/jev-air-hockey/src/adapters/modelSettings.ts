/**
 * Model Selection Settings (Clean Architecture - Adapter Layer)
 *
 * 「どのモデルで戦わせるか」は計測結果を左右するため、推測で自動選定せず
 * 画面から明示的に選ばせる。実際に使えるIDは各社のモデル一覧APIから取得する。
 */

export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

export interface ModelChoice {
  id: string;
  label: string;
  note: string;
}

/** 既定候補。ユーザーのキーで使えるモデルは refresh 系で上書きできる */
export const CLAUDE_MODELS: ModelChoice[] = [
  { id: "claude-opus-5", label: "Claude Opus 5", note: "$5 / $25 per MTok" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", note: "$2 / $10 per MTok" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", note: "$1 / $5 per MTok — 最安" },
];

export const GEMINI_MODELS: ModelChoice[] = [
  { id: "gemini-1.5-flash-8b", label: "Gemini 1.5 Flash-8B", note: "最軽量" },
  { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash", note: "標準の軽量モデル" },
];

export const EFFORT_LEVELS: EffortLevel[] = ["low", "medium", "high", "xhigh", "max"];

const KEY_CLAUDE_MODEL = "selected_claude_model";
const KEY_GEMINI_MODEL = "selected_gemini_model";
const KEY_EFFORT = "selected_effort";

function read(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, value);
  } catch {
    // プライベートモード等で書き込めない場合は既定値で動作を続ける
  }
}

export const ModelSettings = {
  getClaudeModel: (): string => read(KEY_CLAUDE_MODEL) || CLAUDE_MODELS[0].id,
  setClaudeModel: (id: string): void => write(KEY_CLAUDE_MODEL, id),

  getGeminiModel: (): string => read(KEY_GEMINI_MODEL) || GEMINI_MODELS[0].id,
  setGeminiModel: (id: string): void => write(KEY_GEMINI_MODEL, id),

  getEffort: (): EffortLevel => {
    const stored = read(KEY_EFFORT);
    return EFFORT_LEVELS.includes(stored as EffortLevel) ? (stored as EffortLevel) : "medium";
  },
  setEffort: (level: EffortLevel): void => write(KEY_EFFORT, level),
};

/** APIキーで実際に利用できる Gemini モデルIDを列挙する (ドロップダウン用) */
export async function listGeminiModels(apiKey: string): Promise<string[]> {
  if (!apiKey) return GEMINI_MODELS.map((m) => m.id);

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`
    );
    if (!res.ok) throw new Error(`Gemini Models API returned ${res.status}`);

    const data = await res.json();
    const models: Array<{ name: string; supportedGenerationMethods?: string[] }> = data.models || [];
    const ids = models
      .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
      .map((m) => m.name.replace(/^models\//, ""));

    return ids.length > 0 ? ids : GEMINI_MODELS.map((m) => m.id);
  } catch (e) {
    console.warn("Gemini モデル一覧の取得に失敗しました:", e);
    return GEMINI_MODELS.map((m) => m.id);
  }
}
