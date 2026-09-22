/**
 * LLM Client Adapter (System Two: Reflective Generator)
 * Connects to OpenAI/Anthropic/Gemini or uses built-in high fidelity synthesis simulator.
 */

export interface LLMGenerateOptions {
  query: string;
  context: string;
  simulateHallucination?: boolean;
}

export interface LLMResponse {
  content: string;
  claims: string[];
  latencyMs: number;
  tokensUsed: number;
}

export class LLMClient {
  private apiKey: string | null = null;

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

    // If API key is present, could call real OpenAI API
    if (this.apiKey) {
      try {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content:
                  'あなたは社内アシスタントです。提供されたコンテキストのみに基づいて正確に回答してください。推測やコンテキストにない情報を捏造してはいけません。',
              },
              {
                role: 'user',
                content: `【コンテキスト】\n${options.context}\n\n【質問】\n${options.query}`,
              },
            ],
            temperature: 0.2,
          }),
        });

        if (res.ok) {
          const json = await res.json();
          const content = json.choices[0]?.message?.content || '';
          const latencyMs = Math.round(performance.now() - startTime);
          const claims = this.splitIntoClaims(content);
          return {
            content,
            claims,
            latencyMs,
            tokensUsed: json.usage?.total_tokens || 450,
          };
        }
      } catch {
        // Fallback to simulator
      }
    }

    // High fidelity synthesis simulator
    await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 200) + 300));
    const latencyMs = Math.round(performance.now() - startTime);

    const { content, claims, tokensUsed } = this.simulateGeneration(
      options.query,
      options.context,
      options.simulateHallucination
    );

    return {
      content,
      claims,
      latencyMs,
      tokensUsed,
    };
  }

  private simulateGeneration(
    query: string,
    context: string,
    simulateHallucination: boolean = false
  ): { content: string; claims: string[]; tokensUsed: number } {
    let content = '';
    const claims: string[] = [];

    if (query.includes('有給') || query.includes('繰り越し') || query.includes('繰越')) {
      const c1 = '当社の規定に基づき、未使用の有給休暇は翌年度に限り繰り越しが可能です。';
      const c2 = '繰り越し可能な日数は最大20日を限度として定められています。';
      claims.push(c1, c2);

      if (simulateHallucination) {
        // Naive RAG hallucination scenario
        const c3 = 'また、特例として申請により最大100日まで無制限に有休をプールすることができます。';
        claims.push(c3);
        content = `${c1}\n${c2}\n${c3}`;
      } else {
        content = `${c1}\n${c2}`;
      }
    } else if (query.includes('リモート') || query.includes('在宅')) {
      const c1 = 'リモートワーク勤務規程により、月額上限5,000円の通信・光熱費手当が支給されます。';
      const c2 = '適用対象は週3日以上リモートワークを行う正社員および契約社員です。';
      claims.push(c1, c2);
      content = `${c1}\n${c2}`;
    } else if (query.includes('トークン') || query.includes('api') || query.includes('認証')) {
      const c1 = 'APIトークンの有効期限は発行から24時間（86,400秒）に設定されています。';
      const c2 = '有効期限が切れた場合は、リフレッシュトークンエンドポイントより再発行が必要です。';
      claims.push(c1, c2);
      content = `${c1}\n${c2}`;
    } else if (query.includes('解約') || query.includes('返金')) {
      const c1 = 'サービス解約時は契約更新日の7日前までに管理画面より申請が必要です。';
      const c2 = '年払いプランの場合、残月数に応じた日割り計算での返金は原則として受け付けておりません。';
      claims.push(c1, c2);

      if (simulateHallucination) {
        const c3 = 'ただしVIPカスタマーの場合は例外として即時返金100%全額補償が適用されます。';
        claims.push(c3);
        content = `${c1}\n${c2}\n${c3}`;
      } else {
        content = `${c1}\n${c2}`;
      }
    } else {
      const c1 = '提供されたドキュメントに基づき、該当する要件および規定事項を確認しました。';
      const c2 = '詳細な運用手順については社内ガイドラインをご参照ください。';
      claims.push(c1, c2);
      content = `${c1}\n${c2}`;
    }

    const tokensUsed = Math.round(context.length / 3 + content.length / 2 + 120);
    return { content, claims, tokensUsed };
  }

  private splitIntoClaims(text: string): string[] {
    return text
      .split(/[。\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 5)
      .map((s) => (s.endsWith('。') ? s : s + '。'));
  }
}
