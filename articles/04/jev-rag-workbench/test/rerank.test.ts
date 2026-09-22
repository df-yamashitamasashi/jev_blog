import { describe, expect, it } from 'vitest';
import { JevClient } from '../src/adapters/jevClient';
import { SearchResult } from '../src/domain/models';
import { RerankUseCase } from '../src/usecases/rerankUseCase';

describe('RerankUseCase (Gate 3)', () => {
  const client = new JevClient();
  const reranker = new RerankUseCase(client);

  it('should rank highly relevant passages above noise and filter out score < 1.0', async () => {
    const candidates: SearchResult[] = [
      {
        chunk: {
          id: 'c1',
          docId: 'd1',
          docTitle: '有給休暇規程',
          category: 'hr',
          text: '未使用の有休は翌年度に限り繰り越しが可能です。ただし最大20日を限度とします。',
        },
        bm25Score: 2.5,
        denseScore: 0.8,
        hybridScore: 0.65,
      },
      {
        chunk: {
          id: 'c2',
          docId: 'd2',
          docTitle: 'オフィス清掃ルール',
          category: 'general',
          text: '毎週金曜日の夕方にフロアのゴミ箱をまとめて回収します。',
        },
        bm25Score: 0.1,
        denseScore: 0.05,
        hybridScore: 0.05,
      },
    ];

    const result = await reranker.execute('有休の繰り越し上限は何日？', candidates);

    expect(result.passages.length).toBe(2);
    expect(result.acceptedPassages.length).toBe(1);
    expect(result.acceptedPassages[0].chunk.id).toBe('c1');
    expect(result.acceptedPassages[0].relevanceScore).toBeGreaterThanOrEqual(1.5);
    expect(result.rejectedCount).toBe(1);
    expect(result.tokensSavedPercent).toBeGreaterThan(0);
  });
});
