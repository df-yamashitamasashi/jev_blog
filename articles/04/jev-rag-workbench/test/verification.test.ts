import { describe, expect, it } from 'vitest';
import { JevClient } from '../src/adapters/jevClient';
import { RerankedPassage } from '../src/domain/models';
import { VerificationUseCase } from '../src/usecases/verificationUseCase';

describe('VerificationUseCase (Gate 5)', () => {
  const client = new JevClient();
  const verifier = new VerificationUseCase(client);

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

  it('should verify supported factual claims', async () => {
    const claims = ['有給休暇の繰り越し上限は最大20日です。'];
    const result = await verifier.execute(claims, passages);

    expect(result.allPassed).toBe(true);
    expect(result.attributionScore).toBe(100);
    expect(result.claims[0].isSupported).toBe(true);
  });

  it('should flag unsupported or fabricated claims as hallucination', async () => {
    const claims = [
      '有給休暇の繰り越し上限は最大20日です。',
      '特例により100日まで無制限に有休をプールできます。',
    ];
    const result = await verifier.execute(claims, passages);

    expect(result.allPassed).toBe(false);
    expect(result.attributionScore).toBe(50);
    expect(result.claims[0].isSupported).toBe(true);
    expect(result.claims[1].isSupported).toBe(false);
  });
});
