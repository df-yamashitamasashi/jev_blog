/**
 * Jevの choice 回答から選択肢を決めるユーティリティ
 * Clean Architecture - Use Case Layer
 */

import { ChoiceAnswer } from "../domain/jevTypes";

/**
 * choice型の回答は最尤選択肢（answer.choice）だけでなく確率分布
 * （probabilities）も持っている。常にanswer.choiceだけを採用すると、
 * ほぼ同じ状態（フロア・危険度・HP比率など）で繰り返し呼び出した際に
 * Jevが毎回同じ最尤解を返し、「同じモンスターばかり出る」といった
 * 体感的な多様性不足＝離脱要因につながる。
 * probabilitiesに応じた重み付き抽選にすることで、Jevの評価を尊重しつつ
 * 本来期待されるバリエーションを確保する。
 */
export function pickWeightedChoice(answer: ChoiceAnswer): string {
  const entries = Object.entries(answer.probabilities || {}).filter(([, p]) => p > 0);
  const total = entries.reduce((sum, [, p]) => sum + p, 0);
  if (entries.length === 0 || total <= 0) {
    return answer.choice;
  }

  let r = Math.random() * total;
  for (const [key, p] of entries) {
    r -= p;
    if (r <= 0) return key;
  }
  return answer.choice;
}
