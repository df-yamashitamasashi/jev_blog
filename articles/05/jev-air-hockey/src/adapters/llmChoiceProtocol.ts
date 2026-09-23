/**
 * LLM Choice Protocol (Clean Architecture - Adapter Layer)
 *
 * Claude・Gemini に、Jev と同じ選択式の問い ([[choiceQuestions]]) を出すための層。
 * 問いをプロンプトの文章と構造化出力のスキーマに書き起こし、返ってきた答えを
 * Jev の答えと同じ形 ({ 問い: { choice } / { score } }) に戻す。以降の変換と検証は
 * 全エージェント共通。
 *
 * スキーマの値はすべて文字列の選択肢 (段階も "0" "1" … の文字列) にする。
 * 数値の範囲指定は構造化出力で扱えない場合があり、選択肢なら答えが必ず枠内に収まる。
 */

import { AgentTelemetry } from "../domain/jevAgentTypes";
import { INCOMING_SITUATIONS, LINGERING_SITUATIONS } from "../domain/playbook";
import { AirHockeyObservation, PlaybookContext, PlaybookTelemetry } from "./agentClient";
import {
  ChoiceQuestion,
  QuestionSet,
  SITUATION_QUESTIONS,
  PLAYBOOK_GLOBAL_QUESTIONS,
  buildShotQuestions,
  answersToRawPlan,
  answersToRawPlaybook,
  playbookState,
} from "./choiceQuestions";
import {
  INCOMING_DESCRIPTIONS,
  LINGERING_DESCRIPTIONS,
  StructuredCallResult,
  failureTelemetry,
  playbookFailure,
  toPlaybookTelemetry,
  toTelemetry,
} from "./llmShotPlanner";

type Answers = Record<string, { choice?: string; score?: number }>;

/** 問いの選択肢のキー (段階は "0" "1" … ) */
function optionKeys(q: ChoiceQuestion): string[] {
  return Array.isArray(q.criteria) ? q.criteria.map((_, i) => String(i)) : Object.keys(q.criteria);
}

/** 問い1つを、プロンプトに載せる文章にする */
function renderQuestion(key: string, q: ChoiceQuestion): string {
  const options = Array.isArray(q.criteria)
    ? q.criteria.map((label, i) => `  - "${i}": ${label}`)
    : Object.entries(q.criteria).map(([k, label]) => `  - "${k}": ${label}`);
  return `- ${key}: ${q.instructions}\n${options.join("\n")}`;
}

function choiceSchema(q: ChoiceQuestion) {
  return { type: "string", enum: optionKeys(q) };
}

/** LLM が返した選択を、Jev の答えと同じ形に戻す */
function toAnswer(q: ChoiceQuestion, value: unknown): { choice?: string; score?: number } | undefined {
  if (typeof value !== "string") return undefined;
  return q.type === "score" ? { score: Number(value) } : { choice: value };
}

// ─── 中央線での判断 ─────────────────────────────────────

export interface ShotCall {
  prompt: string;
  schema: object;
  questions: QuestionSet;
  contacts: ReturnType<typeof buildShotQuestions>["contacts"];
}

export function buildShotCall(obs: AirHockeyObservation): ShotCall {
  const { request, contacts } = buildShotQuestions(obs);
  const keys = Object.keys(request.questions);

  const prompt = `あなたはエアホッケーの${obs.side === "TOP" ? "上側(TOP)" : "下側(BOTTOM)"}のマレットを操作しています。
パックがいま中央線を越えて、あなたの陣地に入ってきました。

この局面で判断できるのは **この1回だけ** です。選んだ打ち方はそのまま最後まで実行され、
実行中にパックを見て打点や時刻を直すことはありません。予測を外せば空振りし、そのまま失点します。

# 盤面 (座標は原点が左上、x は右、y は下へ増加)
${JSON.stringify(request.state, null, 2)}

# 問い (それぞれ選択肢のキーを1つ選ぶ)
${keys.map((k) => renderQuestion(k, request.questions[k])).join("\n")}

# 出力
${keys.join(", ")} のそれぞれに、選んだ選択肢のキーを入れて返してください。`;

  const schema = {
    type: "object",
    properties: Object.fromEntries(keys.map((k) => [k, choiceSchema(request.questions[k])])),
    required: keys,
    additionalProperties: false,
  };

  return { prompt, schema, questions: request, contacts };
}

/** LLM の答えを、他のエージェントと同じ ShotPlan の検証へ通す */
export function shotTelemetryFromChoices(result: StructuredCallResult, call: ShotCall, obs: AirHockeyObservation): AgentTelemetry {
  if (!result.ok) return failureTelemetry(result.status, result.reason, result.latencyMs);
  if (call.contacts.length === 0) {
    return failureTelemetry("INVALID", "自陣での打点候補がありません", result.latencyMs);
  }

  const raw = (result.raw ?? {}) as Record<string, unknown>;
  const answers: Answers = {};
  for (const [key, q] of Object.entries(call.questions.questions)) {
    const a = toAnswer(q, raw[key]);
    if (a) answers[key] = a;
  }

  const plan = answersToRawPlan(answers, obs, call.contacts);
  if (!plan) return failureTelemetry("INVALID", "contact / aim / path のいずれかが選択肢に無い", result.latencyMs);
  return toTelemetry(plan, obs, result.latencyMs);
}

// ─── 作戦タイム ─────────────────────────────────────────

const SITUATION_KEYS = Object.keys(SITUATION_QUESTIONS) as Array<keyof typeof SITUATION_QUESTIONS>;

/**
 * 20局面 × 5問を別々のプロパティに並べるとスキーマが大きくなりすぎる
 * (Claude が「compiled grammar is too large」で拒否した)。
 * 1局面ぶんの5問を配列の要素として1回だけ定義し、局面名を situation に入れさせる。
 */
function situationArraySchema(situations: readonly string[]) {
  return {
    type: "array",
    items: {
      type: "object",
      properties: {
        situation: { type: "string", enum: [...situations] },
        ...Object.fromEntries(SITUATION_KEYS.map((k) => [k, choiceSchema(SITUATION_QUESTIONS[k])])),
      },
      required: ["situation", ...SITUATION_KEYS],
      additionalProperties: false,
    },
  };
}

export const PLAYBOOK_CHOICE_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    ready: choiceSchema(PLAYBOOK_GLOBAL_QUESTIONS.ready),
    cpu_style: choiceSchema(PLAYBOOK_GLOBAL_QUESTIONS.cpu_style),
    incoming: situationArraySchema(INCOMING_SITUATIONS),
    lingering: situationArraySchema(LINGERING_SITUATIONS),
  },
  required: ["summary", "ready", "cpu_style", "incoming", "lingering"],
  additionalProperties: false,
};

export function buildPlaybookPrompt(ctx: PlaybookContext): string {
  const situations = (desc: Record<string, string>) =>
    Object.entries(desc)
      .map(([k, v]) => `- ${k}: ${v}`)
      .join("\n");

  return `あなたはエアホッケーの${ctx.side === "TOP" ? "上側(TOP)" : "下側(BOTTOM)"}のマレットを操作します。
試合開始前の「作戦タイム」です。イメージトレーニングのつもりで、局面ごとの打ち方を細かく決めてください。

# この作戦が使われる場面
1. パックが中央線を越えてくるたびに、あなたには1回だけ判断の機会があります。
   しかし通信の失敗・時間切れ・応答の不備で判断が届かなかった局面では、ここで決めた incoming の作戦で打ちます。
2. パックが自陣に2秒以上留まっている (中央線を越えないので判断の機会が無い) 局面では、lingering の作戦で打ちます。
3. 作戦どおりに打てない局面は、cpu_style で選んだ動作パターンの CPU に任せます。

# 前提
${JSON.stringify(playbookState(ctx), null, 2)}

# 局面 — 相手から来るパック (incoming)
${situations(INCOMING_DESCRIPTIONS)}

# 局面 — 自陣に居座るパック (lingering)
${situations(LINGERING_DESCRIPTIONS)}

# 局面ごとに答える問い (各局面でそれぞれ選択肢のキーを1つ選ぶ)
${SITUATION_KEYS.map((k) => renderQuestion(k, SITUATION_QUESTIONS[k])).join("\n")}

# 作戦全体で1回だけ答える問い
${Object.entries(PLAYBOOK_GLOBAL_QUESTIONS).map(([k, q]) => renderQuestion(k, q)).join("\n")}

# 出力
summary (作戦全体の方針。40文字以内の日本語), ready, cpu_style, incoming, lingering を返してください。
incoming と lingering は、局面ごとの答えを1要素とする配列です。要素の situation に局面名を入れ、
それぞれ10局面すべてを1つずつ (重複なし) 含めてください。1局面でも欠けた作戦は受け付けられず、作り直しになります。${describePreviousIssues(ctx)}`;
}

/** 作り直しのとき、前回の作戦のどこが不合格だったかを伝える */
function describePreviousIssues(ctx: PlaybookContext): string {
  if (!ctx.previousIssues || ctx.previousIssues.length === 0) return "";
  const shown = ctx.previousIssues.slice(0, 30).map((i) => `- ${i}`).join("\n");
  const more = ctx.previousIssues.length > 30 ? `\n- ほか ${ctx.previousIssues.length - 30} 件` : "";
  return `

# 作り直し
前回の作戦には次の抜け漏れ・不正がありました。すべて直し、20局面すべてを含めて返してください。
${shown}${more}`;
}

/**
 * LLM の作戦 (配列の形) を、Jev の答えと同じ形に戻す。
 * 同じ局面が2回出てきたら、どちらを採るかを決めずに不合格の理由として返す。
 */
export function playbookAnswersFromChoices(raw: unknown): { answers: Answers; issues: string[] } {
  const answers: Answers = {};
  const issues: string[] = [];
  const r = (raw ?? {}) as Record<string, unknown>;

  for (const [key, q] of Object.entries(PLAYBOOK_GLOBAL_QUESTIONS)) {
    const a = toAnswer(q, r[key]);
    if (a) answers[key] = a;
  }

  for (const group of ["incoming", "lingering"] as const) {
    const items = Array.isArray(r[group]) ? (r[group] as Array<Record<string, unknown>>) : [];
    const seen = new Set<string>();
    items.forEach((item, i) => {
      const situation = item?.situation;
      if (typeof situation !== "string") {
        issues.push(`${group}[${i}] に situation が無い`);
        return;
      }
      if (seen.has(situation)) {
        issues.push(`${group}.${situation} が重複している`);
        return;
      }
      seen.add(situation);
      for (const k of SITUATION_KEYS) {
        const a = toAnswer(SITUATION_QUESTIONS[k], item[k]);
        if (a) answers[`${situation}__${k}`] = a;
      }
    });
  }

  return { answers, issues };
}

/** LLM の作戦を、全エージェント共通のガードレール ([[playbook]] の validatePlaybook) に通す */
export function playbookTelemetryFromChoices(result: StructuredCallResult, ctx: PlaybookContext): PlaybookTelemetry {
  if (!result.ok) return playbookFailure(result.status, result.reason, result.latencyMs);

  const { answers, issues } = playbookAnswersFromChoices(result.raw);
  const telemetry = toPlaybookTelemetry(answersToRawPlaybook(answers, ctx), ctx, result.latencyMs);
  if (issues.length === 0) return telemetry;
  return { ...telemetry, playbook: null, status: "INVALID", issues: [...issues, ...telemetry.issues] };
}
