/**
 * Jev Client Adapter
 * Communicates with TypeSafe AI System One API, with a built-in offline simulator.
 *
 * NOTE: シミュレータは本物の Jev ではありません。文字バイグラムの一致率などの簡易ヒューリスティクスで
 * Jev の「出力の形」（確率・スコア）とおおよその遅延を再現し、APIキーなしでパイプラインの流れを体験するためのものです。
 */

import {
  Choice,
  ChoiceAnswer,
  JevQuestion,
  JevRequest,
  JevResponse,
  Noul,
  NoulAnswer,
  Score,
  ScoreAnswer,
} from '../domain/jevPrimitives';
import { coverage, numericFacts, splitTopics } from '../domain/textSimilarity';

export const DEFAULT_JEV_BASE_URL = 'https://api.typesafe.ai';
export const DEFAULT_JEV_MODEL = 'jev-latest';

export interface JevFallbackInfo {
  reason: 'http_error' | 'network_error' | 'timeout';
  detail: string;
}

export class JevClient {
  private apiKey: string | null = null;
  private readonly baseUrl: string;
  private readonly timeoutMs = 10_000;
  onFallback?: (info: JevFallbackInfo) => void;

  constructor(apiKey?: string, baseUrl: string = DEFAULT_JEV_BASE_URL) {
    const envKey = typeof globalThis !== 'undefined' ? (globalThis as any).process?.env?.TYPESAFE_API_KEY : null;
    this.apiKey = apiKey || envKey || null;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  setApiKey(key: string): void {
    this.apiKey = key.trim() || null;
  }

  hasApiKey(): boolean {
    return !!this.apiKey;
  }

  async systemOne(request: JevRequest): Promise<JevResponse> {
    const startTime = performance.now();

    if (this.apiKey) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await fetch(`${this.baseUrl}/v1/systemone`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            state: request.state,
            model: DEFAULT_JEV_MODEL,
            questions: request.questions,
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new Error(`Jev API HTTP error: ${res.status}${body ? ` - ${body.slice(0, 200)}` : ''}`);
        }

        const json = await res.json();
        return {
          answers: json.answers,
          latencyMs: Math.round(performance.now() - startTime),
          isSimulated: false,
        };
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        const reason: JevFallbackInfo['reason'] =
          err instanceof DOMException && err.name === 'AbortError'
            ? 'timeout'
            : detail.startsWith('Jev API HTTP error')
            ? 'http_error'
            : 'network_error';
        // APIキーがあるのに失敗した場合は黙って握りつぶさず、UIへ通知したうえでシミュレータで代替する
        console.warn('[JevClient] Falling back to offline simulator:', detail);
        this.onFallback?.({ reason, detail });
      } finally {
        clearTimeout(timer);
      }
    }

    const simulatedAnswers = this.simulateDecision(request.state, request.questions);
    // Simulated latency: 180 - 300ms (real jev-1.13.0 calls measured p50 ≈ 230ms)
    await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 120) + 180));

    return {
      answers: simulatedAnswers,
      latencyMs: Math.round(performance.now() - startTime),
      isSimulated: true,
    };
  }

  // ---------------------------------------------------------------------------
  // Offline simulator
  // ---------------------------------------------------------------------------

  private simulateDecision(
    state: Record<string, any>,
    questions: Record<string, JevQuestion>
  ): Record<string, ChoiceAnswer | ScoreAnswer | NoulAnswer> {
    const answers: Record<string, ChoiceAnswer | ScoreAnswer | NoulAnswer> = {};

    for (const [key, q] of Object.entries(questions)) {
      if (q.type === 'choice') {
        answers[key] = this.simulateChoice(state, q);
      } else if (q.type === 'score') {
        answers[key] = this.simulateScore(state, q);
      } else {
        answers[key] = this.simulateNoul(state, q);
      }
    }

    return answers;
  }

  private simulateChoice(state: Record<string, any>, choice: Choice): ChoiceAnswer {
    const query = String(state.query || '').toLowerCase();
    const keys = Object.keys(choice.criteria);

    if (keys.includes('direct_answer')) {
      return this.simulateIntent(query);
    }
    if (keys.includes('hr')) {
      return this.simulateRoute(query, keys);
    }

    const selected = keys[0] || 'unknown';
    return { type: 'choice', choice: selected, probabilities: { [selected]: 1.0 }, confidence: 0.5 };
  }

  private simulateIntent(query: string): ChoiceAnswer {
    const greetings = ['こんにちは', 'おはよう', 'こんばんは', 'はじめまして', 'hello', 'hi', 'ありがとう', 'thanks'];
    const vagueWords = ['それ', 'これ', 'あれ', 'どうすればいい', '詳しく', '教えて'];

    const isGreeting = greetings.some((g) => query.includes(g)) && query.length < 20;
    const isVague =
      !isGreeting && ((vagueWords.some((c) => query.includes(c)) && query.length <= 8) || query.trim().length <= 3);

    if (isGreeting) {
      return {
        type: 'choice',
        choice: 'direct_answer',
        probabilities: { direct_answer: 0.96, knowledge_search: 0.03, clarification_needed: 0.01 },
        confidence: 0.94,
      };
    }
    if (isVague) {
      return {
        type: 'choice',
        choice: 'clarification_needed',
        probabilities: { clarification_needed: 0.89, direct_answer: 0.04, knowledge_search: 0.07 },
        confidence: 0.88,
      };
    }
    return {
      type: 'choice',
      choice: 'knowledge_search',
      probabilities: { knowledge_search: 0.95, direct_answer: 0.03, clarification_needed: 0.02 },
      confidence: 0.92,
    };
  }

  private simulateRoute(query: string, keys: string[]): ChoiceAnswer {
    const keywords: Record<string, string[]> = {
      hr: ['有給', '有休', '休暇', '手当', 'リモート', '在宅', '就業', '給与'],
      api: ['api', 'トークン', 'リミット', 'レート', '認証', 'エンドポイント'],
      faq: ['解約', '返金', 'バックアップ', 'エクスポート', '契約', 'faq'],
    };
    const hits = keys.map((k) => ({ k, n: (keywords[k] || []).filter((w) => query.includes(w)).length }));
    const best = hits.reduce((a, b) => (b.n > a.n ? b : a), { k: 'general', n: 0 });
    const selected = best.n > 0 ? best.k : keys.includes('general') ? 'general' : keys[0];

    const probabilities: Record<string, number> = {};
    for (const k of keys) probabilities[k] = k === selected ? 0.9 : 0.1 / Math.max(1, keys.length - 1);
    return { type: 'choice', choice: selected, probabilities, confidence: best.n > 0 ? 0.9 : 0.6 };
  }

  private simulateScore(state: Record<string, any>, score: Score): ScoreAnswer {
    // Batched questions refer to `passage_N`; single-passage questions use `passage`
    const ref = score.instructions.match(/passage_(\d+)/);
    const passage = ref ? state[`passage_${ref[1]}`] : state.passage;
    const ratio = coverage(String(state.query || ''), String(passage || ''), { stripQuestion: true });

    let finalScore: number;
    let confidence: number;
    if (ratio >= 0.5) {
      finalScore = 1.7 + Math.min(0.3, (ratio - 0.5) * 0.6);
      confidence = 0.92;
    } else if (ratio >= 0.25) {
      finalScore = 1.0 + (ratio - 0.25) * 2;
      confidence = 0.78;
    } else {
      finalScore = Math.max(0.05, ratio * 2);
      confidence = 0.85;
    }

    const p2 = Math.max(0, Math.min(1, finalScore - 1));
    const p0 = Math.max(0, Math.min(1, 1 - finalScore));
    return {
      type: 'score',
      score: Math.round(finalScore * 100) / 100,
      probabilities: [p0, 1 - p0 - p2, p2],
      confidence,
    };
  }

  private simulateNoul(state: Record<string, any>, noul: Noul): NoulAnswer {
    const instructions = noul.instructions;

    // Gate 5: claim is supported by source? (batched questions refer to `claim_N`)
    const claimRef = instructions.match(/claim_(\d+)/);
    if (claimRef || 'claim' in state) {
      const claim = String((claimRef ? state[`claim_${claimRef[1]}`] : state.claim) || '');
      const source = String(state.source || '');

      // 主張に含まれる数値（20日、5,000円など）が根拠に存在しなければ裏付けなしとみなす
      const sourceFacts = new Set(numericFacts(source));
      const missingFact = numericFacts(claim).some((f) => !sourceFacts.has(f));
      const ratio = coverage(claim, source);

      const prob = missingFact ? 0.12 : ratio >= 0.6 ? 0.94 : ratio >= 0.4 ? 0.7 : 0.25;
      return { type: 'noul', noul: prob, confidence: 0.9 };
    }

    // Gate 2: needs decomposition?
    if (instructions.includes('分解') || instructions.includes('分けて調べる')) {
      const query = String(state.query || '');
      const topics = splitTopics(query);
      const hasComparison = ['違い', '比較', 'vs', '併用', 'それぞれ', '両方'].some((w) => query.toLowerCase().includes(w));
      const prob = topics.length >= 2 ? (hasComparison ? 0.9 : 0.8) : 0.12;
      return { type: 'noul', noul: prob, confidence: 0.89 };
    }

    // Gate 4: is the context sufficient? (context = all `passage_N` in a batched call)
    const passages = Object.keys(state).filter((k) => /^passage_\d+$/.test(k));
    if ('context' in state || passages.length > 0) {
      const query = String(state.query || '');
      const context = String(state.context ?? passages.map((k) => state[k]).join('\n\n'));
      if (context.trim().length === 0) return { type: 'noul', noul: 0.02, confidence: 0.98 };

      const ratio = coverage(query, context, { stripQuestion: true });
      const prob = ratio >= 0.5 ? 0.92 : ratio >= 0.35 ? 0.6 : 0.12;
      return { type: 'noul', noul: prob, confidence: 0.91 };
    }

    return { type: 'noul', noul: 0.5, confidence: 0.5 };
  }
}
