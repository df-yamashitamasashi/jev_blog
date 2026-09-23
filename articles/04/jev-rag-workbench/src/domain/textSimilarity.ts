/**
 * Lightweight Japanese text matching utilities (no morphological analyzer).
 *
 * 日本語は空白で単語が区切られないため、漢字・カタカナの連続部分を文字バイグラムに分解し、
 * 英数字は単語単位で扱う。ひらがな（助詞・送り仮名）は内容語ではないので除外する。
 */

// 表記ゆれの正規化（送り仮名・略語）
const SYNONYMS: [RegExp, string][] = [
  [/有休/g, '有給休暇'],
  [/有給(?!休暇)/g, '有給休暇'],
  [/繰り越し|繰越し/g, '繰越'],
  [/在宅勤務|リモートワーク|テレワーク/g, '在宅勤務'],
  [/限度/g, '上限'],
];

// 質問表現は検索語として意味を持たないため除去する
const QUESTION_PHRASES =
  /(について|を?教えてください|教えて|ですか|ますか|でしょうか|何日|何回|何時間|いくら|どのくらい|どれくらい|ください|とは|方法)/g;

export function normalizeJa(text: string): string {
  let t = text.normalize('NFKC').toLowerCase();
  for (const [pattern, replacement] of SYNONYMS) {
    t = t.replace(pattern, replacement);
  }
  return t;
}

/**
 * Content tokens: ASCII words / numbers as-is, Kanji & Katakana runs as character bigrams.
 */
export function contentTokens(text: string, options: { stripQuestion?: boolean } = {}): string[] {
  let t = normalizeJa(text);
  if (options.stripQuestion) t = t.replace(QUESTION_PHRASES, ' ');

  const tokens: string[] = [];
  const runs = t.match(/[a-z0-9]+|[\u30a0-\u30ff\u3400-\u9fff]+/g) || [];
  for (const run of runs) {
    if (/^[a-z0-9]+$/.test(run)) {
      tokens.push(run);
      continue;
    }
    if (run.length === 1) continue;
    for (let i = 0; i < run.length - 1; i++) {
      tokens.push(run.slice(i, i + 2));
    }
  }
  return tokens;
}

/**
 * Fraction of the (unique) query tokens that also appear in the target text. Range [0, 1].
 */
export function coverage(queryText: string, targetText: string, options: { stripQuestion?: boolean } = {}): number {
  const queryTokens = new Set(contentTokens(queryText, options));
  if (queryTokens.size === 0) return 0;
  const targetTokens = new Set(contentTokens(targetText));
  let hit = 0;
  for (const token of queryTokens) {
    if (targetTokens.has(token)) hit++;
  }
  return hit / queryTokens.size;
}

/**
 * Numbers with units (e.g. "20日", "5,000円") mentioned in the text.
 */
export function numericFacts(text: string): string[] {
  const t = text.normalize('NFKC');
  return (t.match(/\d[\d,]*(?:\.\d+)?\s*(?:日間|日|円|秒|時間|分|件|回|%|年|ヶ月|か月|リクエスト)?/g) || []).map((s) =>
    s.replace(/[,\s]/g, '')
  );
}

/**
 * Split a compound query ("AとBの違いは？") into topic phrases that each carry content words.
 */
export function splitTopics(query: string): string[] {
  return query
    .split(/と|及び|および|並びに|、|,|\bvs\b/i)
    .map((p) => p.trim())
    .filter((p) => contentTokens(p, { stripQuestion: true }).length >= 2);
}

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？!?])|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 5);
}

/** Rough token estimate for Japanese-heavy text (≈1.5 chars per token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 1.5);
}
