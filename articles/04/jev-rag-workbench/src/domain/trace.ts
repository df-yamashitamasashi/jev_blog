/**
 * Trace: "who did what, how" for one question — the data behind the flow diagram.
 *
 * A RunRecord is the normalized result of one pipeline run. It comes either from a live run
 * in the browser (RagResult) or from a recorded run of the Python package against the real
 * Jev / Gemini APIs (public/replays.json).
 */

import { RagResult, RerankedPassage } from './models';

export type Actor = 'user' | 'jev' | 'search' | 'llm';
export type RunStatus = 'answered' | 'no_answer' | 'direct' | 'clarify';

export interface RunPassage {
  id: string;
  title: string;
  heading?: string;
  text: string;
  relevance: number | null;
  accepted: boolean;
}

export interface RunClaim {
  text: string;
  support: number | null;
  supported: boolean | null;
}

export interface RunRecord {
  query: string;
  status: RunStatus;
  answer: string;
  triage: {
    intent: string;
    intentConfidence: number;
    route: string | null;
    routeConfidence: number;
    decompose: number;
  };
  subQueries: string[];
  retrieved: RunPassage[];
  sufficiency: number | null;
  claims: RunClaim[];
  timingsMs: Partial<Record<'triage' | 'retrieval' | 'assess' | 'generate' | 'verify', number>>;
  totalMs: number | null; // null when no real timing was recorded
  jevCalls: number;
  llmTokens: number;
  thresholds: { relevance: number; sufficiency: number; support: number };
  baseline?: { answer: string; totalMs: number | null; llmTokens: number };
}

export interface TraceStep {
  from: Actor;
  to: Actor;
  /** Short text written on the arrow */
  label: string;
  /** Who acted in this step (shown as the badge on the explanation card) */
  actor: Actor;
  title: string;
  what: string;
  result: string;
  outcome: 'info' | 'pass' | 'stop' | 'warn';
  ms?: number;
  passages?: RunPassage[];
  claims?: RunClaim[];
  quote?: string;
}

export const ACTORS: Record<Actor, { name: string; role: string; icon: string }> = {
  user: { name: '利用者', role: '質問する人', icon: '👤' },
  jev: { name: 'Jev', role: 'System One：判断する', icon: '🧭' },
  search: { name: '検索', role: 'BM25 + Embedding', icon: '🔎' },
  llm: { name: 'LLM', role: 'System Two：文章を書く', icon: '✍️' },
};

const pct = (v: number) => `${Math.round(v * 100)}%`;
const ROUTE_LABEL: Record<string, string> = {
  hr: '人事・労務',
  expense: '経費・出張',
  security: 'IT・セキュリティ',
  api: 'API仕様',
  faq: '顧客FAQ',
  general: 'その他',
};
const INTENT_LABEL: Record<string, string> = {
  knowledge_search: '文書を調べる',
  direct_answer: '挨拶・雑談',
  clarification_needed: '曖昧な質問',
};

export function buildTrace(run: RunRecord): TraceStep[] {
  const t = run.triage;
  const th = run.thresholds;
  const steps: TraceStep[] = [
    {
      from: 'user',
      to: 'jev',
      label: '質問',
      actor: 'user',
      title: '質問する',
      what: `「${run.query}」`,
      result: 'まず Jev が、この質問をどう扱うかを決めます。',
      outcome: 'info',
    },
  ];

  // A sub-query identical to the question adds nothing to show (no separator to split on)
  const subQueries = run.subQueries.filter((q) => q !== run.query);
  const decomposeText =
    subQueries.length > 0
      ? `複数の事柄を聞いている（${pct(t.decompose)}）→「${subQueries.join('」「')}」でも検索`
      : t.decompose >= 0.75
      ? `複数の事柄を聞いている（${pct(t.decompose)}）が、区切れないので質問全体で検索`
      : `1つの事柄（複合質問の確率 ${pct(t.decompose)}）`;
  steps.push({
    from: 'jev',
    to: 'jev',
    label: '判断①',
    actor: 'jev',
    title: '判断①：どう扱うかを決める',
    what: '挨拶か／曖昧か／文書を調べるべきか、分野はどこか、複数の事柄を聞いているかを、1回の呼び出しでまとめて判定しました。',
    result:
      `${INTENT_LABEL[t.intent] ?? t.intent}（確信度 ${pct(t.intentConfidence)}）` +
      (run.status === 'direct' || run.status === 'clarify'
        ? ''
        : `・分野: ${t.route ? ROUTE_LABEL[t.route] ?? t.route : '判定なし'}・${decomposeText}`),
    outcome: run.status === 'direct' || run.status === 'clarify' ? 'stop' : 'pass',
    ms: run.timingsMs.triage,
  });

  if (run.status === 'direct' || run.status === 'clarify') {
    steps.push({
      from: 'jev',
      to: 'user',
      label: run.status === 'direct' ? '定型の返答' : '聞き返し',
      actor: 'jev',
      title: run.status === 'direct' ? '検索も LLM も使わずに返答' : '内容を確認するために聞き返す',
      what: '文書を調べる必要がないので、ここで終了しました。',
      result: `検索・LLM は呼ばれていません（Jev ${run.jevCalls}回・LLM 0トークン）。`,
      outcome: 'stop',
      quote: run.answer,
    });
    return steps;
  }

  const accepted = run.retrieved.filter((p) => p.accepted);
  steps.push({
    from: 'jev',
    to: 'search',
    label: subQueries.length > 0 ? `検索語 ${subQueries.length + 1}件` : '検索語',
    actor: 'search',
    title: '検索：候補の文書を集める',
    what: 'キーワードの一致（BM25）と意味の近さ（Embedding）の両方で探し、順位を統合して上位を取り出しました。',
    result: `${run.retrieved.length}件の候補：${run.retrieved.map((p) => p.title).join('、')}`,
    outcome: run.retrieved.length > 0 ? 'pass' : 'stop',
    ms: run.timingsMs.retrieval,
  });

  const sufficient = run.status !== 'no_answer';
  steps.push({
    from: 'search',
    to: 'jev',
    label: `候補 ${run.retrieved.length}件`,
    actor: 'jev',
    title: '判断②：使える文書を選び、答えられるかを決める',
    what: `${run.retrieved.length}件それぞれに答えが書いてあるかを0〜2点で採点し、全体で正確に答えられるかも、1回の呼び出しでまとめて判定しました。`,
    result:
      `採用 ${accepted.length}件（${th.relevance.toFixed(1)}点以上）・除外 ${run.retrieved.length - accepted.length}件` +
      (run.sufficiency !== null
        ? `・答えられる確率 ${pct(run.sufficiency)}（基準 ${pct(th.sufficiency)}）`
        : ''),
    outcome: sufficient ? 'pass' : 'stop',
    ms: run.timingsMs.assess,
    passages: run.retrieved,
  });

  if (!sufficient) {
    steps.push({
      from: 'jev',
      to: 'user',
      label: '見つかりません',
      actor: 'jev',
      title: 'LLM を呼ばずに「見つかりませんでした」と返す',
      what: '文書に根拠が足りないため、回答の作成に進みませんでした。LLM が推測で答える余地をなくしています。',
      result: `LLM は呼ばれていません（Jev ${run.jevCalls}回・LLM 0トークン）。`,
      outcome: 'stop',
      quote: run.answer,
    });
    return steps;
  }

  steps.push({
    from: 'jev',
    to: 'llm',
    label: `採用した ${accepted.length}件`,
    actor: 'llm',
    title: '回答を書く',
    what: `採用した${accepted.length}件の文書だけを渡し、「書かれていることだけで、引用番号つきで答える」よう指示しました。`,
    result: `${run.claims.length}文・${run.llmTokens}トークン`,
    outcome: 'pass',
    ms: run.timingsMs.generate,
    quote: run.answer,
  });

  const verified = run.claims.filter((c) => c.supported !== null);
  const unsupported = verified.filter((c) => c.supported === false);
  steps.push({
    from: 'llm',
    to: 'jev',
    label: `回答 ${run.claims.length}文`,
    actor: 'jev',
    title: '判断③：回答を1文ずつ文書と照合する',
    what: `LLM とは別の目で、各文が文書に書かれていることだけで裏付けられるかを、1回の呼び出しで判定しました（基準 ${pct(th.support)}）。`,
    result:
      verified.length === 0
        ? '照合が必要な文はありませんでした。'
        : unsupported.length === 0
        ? `${verified.length}文すべてに根拠あり`
        : `${verified.length}文中 ${unsupported.length}文の根拠を確認できず → 印を付けて利用者に知らせる`,
    outcome: unsupported.length === 0 ? 'pass' : 'warn',
    ms: run.timingsMs.verify,
    claims: run.claims,
  });

  steps.push({
    from: 'jev',
    to: 'user',
    label: '回答＋引用',
    actor: 'jev',
    title: '回答を返す',
    what: '回答に、引用元の文書と、各文の照合結果を付けて返しました。',
    result:
      (run.totalMs !== null ? `合計 ${Math.round(run.totalMs).toLocaleString()} ms・` : '') +
      `Jev ${run.jevCalls}回・LLM ${run.llmTokens}トークン`,
    outcome: unsupported.length === 0 ? 'pass' : 'warn',
  });
  return steps;
}

/** Convert a live Workbench run into a RunRecord. */
export function runFromRagResult(
  result: RagResult,
  thresholds: RunRecord['thresholds']
): RunRecord {
  const stage = (id: string) => result.stages.find((s) => s.stageId === id);
  const triage = stage('triage')?.details.triage;
  const retrieval = stage('retrieval')?.details;
  const sufficiency = stage('sufficiency')?.details.sufficiency;
  const passages: RerankedPassage[] = result.rerankedPassages;
  const status: RunStatus = result.isDirectAnswer
    ? 'direct'
    : result.isClarificationNeeded
    ? 'clarify'
    : result.isFallback
    ? 'no_answer'
    : 'answered';

  const ms = (id: string) => stage(id)?.latencyMs;
  return {
    query: result.query,
    status,
    answer: result.finalAnswer,
    triage: {
      intent: triage?.intent ?? 'knowledge_search',
      intentConfidence: triage?.answer?.confidence ?? 0,
      route: triage?.targetCategory ?? triage?.routeAnswer?.choice ?? null,
      routeConfidence: triage?.routeAnswer?.confidence ?? 0,
      decompose: triage?.decompositionNoul?.noul ?? 0,
    },
    subQueries: (retrieval?.subQueries ?? []).slice(1),
    retrieved: passages.map((p) => ({
      id: p.chunk.id,
      title: p.chunk.docTitle,
      text: p.chunk.text,
      relevance: p.relevanceScore,
      accepted: p.isAccepted,
    })),
    sufficiency: sufficiency ? sufficiency.sufficiencyScore : null,
    claims: result.verifiedClaims.map((c) => ({
      text: c.claim,
      support: c.supportScore,
      supported: c.isSupported,
    })),
    timingsMs: {
      triage: ms('triage'),
      retrieval: ms('retrieval'),
      assess: ms('rerank'),
      generate: ms('generation'),
      verify: ms('verification'),
    },
    totalMs: result.totalLatencyMs,
    // triage always calls Jev; assess / verify only when they actually ran
    jevCalls: result.stages.filter(
      (s) => s.stageId === 'triage' || (['rerank', 'verification'].includes(s.stageId) && s.latencyMs > 0)
    ).length,
    llmTokens: result.llmTokensUsed,
    thresholds,
  };
}
