import { describe, expect, it } from 'vitest';
import { JevClient } from '../src/adapters/jevClient';
import { RerankedPassage } from '../src/domain/models';
import { SufficiencyUseCase } from '../src/usecases/sufficiencyUseCase';

describe('SufficiencyUseCase (Gate 4)', () => {
  const client = new JevClient();
  const sufficiency = new SufficiencyUseCase(client);

  it('should pass sufficiency when context contains direct facts', async () => {
    const passages: RerankedPassage[] = [
      {
        chunk: {
          id: 'c1',
          docId: 'd1',
          docTitle: '有給規程',
          category: 'hr',
          text: '未使用の有給休暇は最大20日まで翌年度に繰り越しできます。',
        },
        relevanceScore: 1.9,
        confidence: 0.9,
        scoreAnswer: { score: 1.9, confidence: 0.9 },
        isAccepted: true,
      },
    ];

    const result = await sufficiency.execute('有休の繰り越し上限は何日？', passages);
    expect(result.isSufficient).toBe(true);
    expect(result.sufficiencyScore).toBeGreaterThanOrEqual(0.7);
  });

  it('should fail sufficiency when query is completely absent from knowledge', async () => {
    const passages: RerankedPassage[] = [
      {
        chunk: {
          id: 'c1',
          docId: 'd1',
          docTitle: '有給規程',
          category: 'hr',
          text: '未使用の有給休暇は最大20日まで翌年度に繰り越しできます。',
        },
        relevanceScore: 0.2,
        confidence: 0.8,
        scoreAnswer: { score: 0.2, confidence: 0.8 },
        isAccepted: true,
      },
    ];

    const result = await sufficiency.execute('宇宙旅行の手当申請フローは？', passages);
    expect(result.isSufficient).toBe(false);
    expect(result.sufficiencyScore).toBeLessThan(0.7);
  });
});
