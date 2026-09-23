import { describe, expect, it } from 'vitest';
import { InMemoryRetriever } from '../src/adapters/inMemoryRetriever';
import { JevClient } from '../src/adapters/jevClient';
import { LLMClient } from '../src/adapters/llmClient';
import { buildTrace, runFromRagResult, RunRecord } from '../src/domain/trace';
import { RagOrchestrator } from '../src/usecases/ragOrchestrator';

const TH = { relevance: 1.0, sufficiency: 0.7, support: 0.85 };

const base: RunRecord = {
  query: 'q',
  status: 'answered',
  answer: 'a',
  triage: { intent: 'knowledge_search', intentConfidence: 0.9, route: 'hr', routeConfidence: 1, decompose: 0.1 },
  subQueries: [],
  retrieved: [
    { id: 'c1', title: '休暇規程', text: 't', relevance: 1.8, accepted: true },
    { id: 'c2', title: 'オフィス', text: 't', relevance: 0.1, accepted: false },
  ],
  sufficiency: 0.95,
  claims: [{ text: '上限は20日です。', support: 0.97, supported: true }],
  timingsMs: { triage: 200, retrieval: 100, assess: 200, generate: 2000, verify: 200 },
  totalMs: 2700,
  jevCalls: 3,
  llmTokens: 400,
  thresholds: TH,
};

describe('buildTrace (who did what)', () => {
  it('answered: user → Jev → search → Jev → LLM → Jev → user', () => {
    const steps = buildTrace(base);
    expect(steps.map((s) => `${s.from}>${s.to}`)).toEqual([
      'user>jev',
      'jev>jev',
      'jev>search',
      'search>jev',
      'jev>llm',
      'llm>jev',
      'jev>user',
    ]);
    expect(steps[3].result).toContain('採用 1件');
  });

  it('no_answer stops before the LLM', () => {
    const steps = buildTrace({ ...base, status: 'no_answer', sufficiency: 0.1, claims: [], llmTokens: 0 });
    expect(steps.some((s) => s.to === 'llm')).toBe(false);
    expect(steps[steps.length - 1]).toMatchObject({ to: 'user', outcome: 'stop' });
  });

  it('greetings never reach search or the LLM', () => {
    const steps = buildTrace({ ...base, status: 'direct', triage: { ...base.triage, intent: 'direct_answer' } });
    expect(steps.map((s) => s.to)).toEqual(['jev', 'jev', 'user']);
  });

  it('flags unsupported sentences as a warning', () => {
    const steps = buildTrace({ ...base, claims: [{ text: 'x', support: 0.1, supported: false }] });
    expect(steps.find((s) => s.title.startsWith('判断③'))?.outcome).toBe('warn');
  });

  it('hides sub-queries identical to the question', () => {
    const steps = buildTrace({ ...base, triage: { ...base.triage, decompose: 0.8 }, subQueries: ['q'] });
    expect(steps[1].result).toContain('区切れない');
    expect(steps[2].label).toBe('検索語');
  });
});

describe('runFromRagResult', () => {
  it('converts a live Workbench run', async () => {
    const orchestrator = new RagOrchestrator(new JevClient(), new LLMClient(), new InMemoryRetriever());
    const run = runFromRagResult(await orchestrator.runPipeline('有給休暇の繰り越し上限は何日ですか？'), TH);
    expect(run.status).toBe('answered');
    expect(run.jevCalls).toBe(3);
    expect(run.retrieved.some((p) => p.accepted)).toBe(true);
    expect(buildTrace(run)).toHaveLength(7);
  });
});
