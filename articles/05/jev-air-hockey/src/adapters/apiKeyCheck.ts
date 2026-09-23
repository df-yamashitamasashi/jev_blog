/**
 * API Key Guardrails (Clean Architecture - Adapter Layer)
 *
 * 「キーを入れたのに無効と言われる」原因の多くは、キーそのものではなく貼り付け方と
 * キーの種類にある。保存する前にここで弾き、何が悪いのかをその場で伝える。
 */

import Anthropic from "@anthropic-ai/sdk";

/**
 * 貼り付けで紛れ込む文字を取り除く。
 * 前後の空白だけでなく、途中の改行・ゼロ幅スペース・全角空白なども落とす
 * (trim() では消えず、見た目では気づけないまま 401 になる)。
 */
export function sanitizeApiKey(raw: string): string {
  return raw.replace(/[\s​-‍⁠﻿　]/g, "").replace(/[^\x21-\x7e]/g, "");
}

/** Claude のキーとして使えない形なら、その理由を返す (問題なければ null) */
export function claudeKeyIssue(key: string): string | null {
  if (!key) return null;
  if (key.startsWith("sk-ant-oat")) {
    return "Claude.ai / Claude Code のログイン用トークンです。Claude Console (console.anthropic.com) で発行した API キー (sk-ant-api…) を使ってください";
  }
  if (key.startsWith("sk-ant-admin")) {
    return "Admin API キーです。会話には使えません。通常の API キー (sk-ant-api…) を使ってください";
  }
  if (!key.startsWith("sk-ant-api")) {
    return "Claude の API キーは sk-ant-api で始まります。別のサービスのキー、または貼り付けが途中で切れていないか確認してください";
  }
  return null;
}

export interface KeyCheckResult {
  ok: boolean;
  /** 利用者に見せる説明 */
  message: string;
}

/**
 * キーが実際に使えるかを Anthropic API で確かめる。
 * モデル一覧の取得なのでトークンは消費しない。
 */
export async function verifyClaudeKey(key: string): Promise<KeyCheckResult> {
  const issue = claudeKeyIssue(key);
  if (issue) return { ok: false, message: issue };

  try {
    const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 0, timeout: 15000 });
    await client.models.list({ limit: 1 });
    return { ok: true, message: "有効なキーです" };
  } catch (e) {
    return { ok: false, message: describeClaudeError(e, key) };
  }
}

/** API エラー本文のメッセージだけを取り出す (無ければ SDK のメッセージ) */
function serverMessage(e: InstanceType<typeof Anthropic.APIError>): string {
  const body = e.error as { error?: { message?: string } } | undefined;
  return body?.error?.message ?? e.message;
}

/** Claude API のエラーを、利用者が次に何をすればよいか分かる文にする */
export function describeClaudeError(e: unknown, key?: string): string {
  if (e instanceof Anthropic.AuthenticationError) {
    const hint = key ? claudeKeyIssue(key) : null;
    return `APIキーが無効です (401: ${serverMessage(e)})${hint ? ` — ${hint}` : " — キーが失効・削除されていないか、別の組織・ワークスペースのキーでないか Console で確認してください"}`;
  }
  if (e instanceof Anthropic.PermissionDeniedError) {
    return `このキーには権限がありません (403: ${serverMessage(e)})`;
  }
  if (e instanceof Anthropic.NotFoundError) {
    return `モデルが見つかりません (404: ${serverMessage(e)}) — モデルの選択を確認してください`;
  }
  if (e instanceof Anthropic.RateLimitError) return "レート制限に達しました";
  if (e instanceof Anthropic.APIConnectionError) return `Anthropic API へ接続できません (${e.message})`;
  if (e instanceof Anthropic.APIError) return `APIエラー ${e.status}: ${serverMessage(e)}`;
  return e instanceof Error ? e.message : String(e);
}
