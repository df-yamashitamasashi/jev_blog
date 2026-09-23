import { describe, expect, it, vi } from 'vitest';
import { JevClient } from '../src/adapters/jevClient';
import { TriageUseCase } from '../src/usecases/triageUseCase';

describe('TriageUseCase (Gate 1 & Gate 2)', () => {
  const client = new JevClient();
  const triage = new TriageUseCase(client);

  it('should triage greeting queries as direct_answer', async () => {
    const result = await triage.execute('こんにちは！よろしくお願いします。');
    expect(result.intent).toBe('direct_answer');
    expect(result.needsDecomposition).toBe(false);
  });

  it('should triage vague short queries as clarification_needed', async () => {
    const result = await triage.execute('それについて');
    expect(result.intent).toBe('clarification_needed');
  });

  it('should triage policy query as knowledge_search with category routing', async () => {
    const result = await triage.execute('有給休暇の繰り越し上限は何日ですか？');
    expect(result.intent).toBe('knowledge_search');
    expect(result.targetCategory).toBe('hr');
  });

  it('should detect complex queries requiring decomposition', async () => {
    const result = await triage.execute('有給休暇と特別休暇の繰り越しの違いについて教えてください');
    expect(result.intent).toBe('knowledge_search');
    expect(result.needsDecomposition).toBe(true);
    expect(result.subQueries.length).toBeGreaterThan(1);
  });

  it('should route via the Jev route question rather than hard-coded rules', async () => {
    const result = await triage.execute('APIのレート制限は1分あたり何回ですか？');
    expect(result.routeAnswer?.choice).toBe('api');
    expect(result.targetCategory).toBe('api');
  });

  it('treats a low-confidence "vague" verdict as a real question', async () => {
    const unsure = new JevClient();
    vi.spyOn(unsure, 'systemOne').mockResolvedValue({
      answers: {
        intent: { choice: 'clarification_needed', probabilities: {}, confidence: 0.27 },
        decompose: { noul: 0.1 },
      },
      latencyMs: 1,
      isSimulated: true,
    });
    const result = await new TriageUseCase(unsure).execute('インボイスの登録番号を教えて');
    expect(result.intent).toBe('knowledge_search');
  });
});
