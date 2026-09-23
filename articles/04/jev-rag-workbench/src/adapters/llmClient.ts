/**
 * LLM Client Adapter (System Two: Reflective Generator)
 * Calls the OpenAI Chat Completions API, or falls back to a built-in generation simulator.
 *
 * シミュレータの挙動:
 *  - コンテキスト中に質問と重なる文があれば、その文を抜き出して回答する（抽出型）
 *  - 見つからない場合は「何か答えなければ」というLLMの典型的な失敗を再現し、もっともらしい捏造回答を返す
 *    （Naive RAG でハルシネーションが起きる状況の再現。Jev RAG では Gate 4 がこの手前で止める）
 */

import { contentTokens, coverage, estimateTokens, splitSentences, splitTopics } from '../domain/textSimilarity';

export interface LLMGenerateOptions {
  query: string;
  context: string;
}

export interface LLMResponse {
  content: string;
  claims: string[];
  latencyMs: number;
  tokensUsed: number;
  isSimulated: boolean;
}

export const DEFAULT_LLM_MODEL = 'gpt-4o-mini';

const SYSTEM_PROMPT =
  'あなたは社内アシスタントです。提供されたコンテキストのみに基づいて正確に回答してください。推測やコンテキストにない情報を捏造してはいけません。';

export class LLMClient {
  private apiKey: string | null = null;
  onFallback?: (detail: string) => void;

  constructor(apiKey?: string) {
    const envKey = typeof globalThis !== 'undefined' ? (globalThis as any).process?.env?.OPENAI_API_KEY : null;
    this.apiKey = apiKey || envKey || null;
  }

  setApiKey(key: string): void {
    this.apiKey = key.trim() || null;
  }

  hasApiKey(): boolean {
    return !!this.apiKey;
  }

  async generate(options: LLMGenerateOptions): Promise<LLMResponse> {
    const startTime = performance.now();

    if (this.apiKey) {
      try {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: DEFAULT_LLM_MODEL,
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: `【コンテキスト】\n${options.context}\n\n【質問】\n${options.query}` },
            ],
            temperature: 0.2,
          }),
        });

        if (!res.ok) {
          throw new Error(`OpenAI API HTTP error: ${res.status}`);
        }

        const json = await res.json();
        const content: string = json.choices[0]?.message?.content || '';
        return {
          content,
          claims: splitSentences(content),
          latencyMs: Math.round(performance.now() - startTime),
          tokensUsed:
            json.usage?.total_tokens ?? estimateTokens(SYSTEM_PROMPT + options.context + options.query + content),
          isSimulated: false,
        };
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        console.warn('[LLMClient] Falling back to generation simulator:', detail);
        this.onFallback?.(detail);
      }
    }

    const { content, claims } = this.simulateGeneration(options.query, options.context);
    const inputTokens = estimateTokens(SYSTEM_PROMPT + options.context + options.query);
    const outputTokens = estimateTokens(content);

    // Simulated latency: fixed overhead + prompt processing + token-by-token decoding
    const simulatedMs = 250 + inputTokens * 0.3 + outputTokens * 6 + Math.random() * 100;
    await new Promise((resolve) => setTimeout(resolve, simulatedMs));

    return {
      content,
      claims,
      latencyMs: Math.round(performance.now() - startTime),
      tokensUsed: inputTokens + outputTokens,
      isSimulated: true,
    };
  }

  private simulateGeneration(query: string, context: string): { content: string; claims: string[] } {
    // 挨拶など内容語を含まない入力には会話として応答する（事実の主張を含まない）
    if (contentTokens(query, { stripQuestion: true }).length === 0) {
      return { content: 'こんにちは！社内規程や仕様について、ご質問があればお気軽にどうぞ。', claims: [] };
    }

    // 見出し行（「第13条（…）」など句点で終わらない行）は回答文として使わない
    const sentences = splitSentences(context).filter((s) => /[。！？]$/.test(s));
    // 複合質問（「AとB」）では、まず各トピックに最もよく答える文を1つずつ選び、残りを全体の一致率順で埋める
    const topics = splitTopics(query);
    const queries = [query, ...topics];
    const scoreOf = (s: string, q: string) => coverage(q, s, { stripQuestion: true });

    const selected: string[] = [];
    if (topics.length > 1) {
      for (const topic of topics) {
        const best = sentences
          .filter((s) => !selected.includes(s))
          .map((s) => ({ s, ratio: scoreOf(s, topic) }))
          .sort((a, b) => b.ratio - a.ratio)[0];
        if (best && best.ratio >= 0.3) selected.push(best.s);
      }
    }
    const ranked = sentences
      .filter((s) => !selected.includes(s))
      .map((s) => ({ s, ratio: Math.max(...queries.map((q) => scoreOf(s, q))) }))
      .filter((x) => x.ratio >= 0.3)
      .sort((a, b) => b.ratio - a.ratio);
    for (const x of ranked) {
      if (selected.length >= 3) break;
      selected.push(x.s);
    }

    if (selected.length > 0) {
      return { content: selected.join('\n'), claims: selected };
    }

    // No grounding found: reproduce a typical "must answer something" hallucination
    const topic = query.replace(/[?？!！。]/g, '').replace(/(について|を?教えてください|の申請方法は|は何日ですか|はいくらですか|は)$/, '');
    const claims = [
      `${topic}は、所定の申請フォームから所属長の承認を得ることで利用できます。`,
      '支給額は1回あたり最大30,000円で、申請から10営業日以内に処理されます。',
    ];
    return { content: claims.join('\n'), claims };
  }
}
