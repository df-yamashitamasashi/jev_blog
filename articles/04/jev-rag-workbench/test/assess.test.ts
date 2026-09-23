import { afterEach, describe, expect, it, vi } from 'vitest';
import { JevClient } from '../src/adapters/jevClient';
import { SearchResult } from '../src/domain/models';
import { AssessUseCase } from '../src/usecases/assessUseCase';

const candidate = (id: string, docTitle: string, text: string): SearchResult => ({
  chunk: { id, docId: id, docTitle, category: 'hr', text },
  bm25Score: 0,
  denseScore: 0,
  hybridScore: 0,
});

const CARRY_OVER = candidate('c1', '有給休暇規程', '未使用の有休は翌年度に限り繰り越しが可能です。ただし最大20日を限度とします。');
const GARBAGE = candidate('c2', 'オフィス清掃ルール', '毎週金曜日の夕方にフロアのゴミ箱をまとめて回収します。');

describe('AssessUseCase (Gate 3 + Gate 4 in one Jev call)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('scores every passage and checks sufficiency with a single call', async () => {
    const client = new JevClient();
    const spy = vi.spyOn(client, 'systemOne');
    const result = await new AssessUseCase(client).execute('有休の繰り越し上限は何日？', [CARRY_OVER, GARBAGE]);

    expect(spy).toHaveBeenCalledTimes(1);
    const { state, questions } = spy.mock.calls[0][0];
    expect(Object.keys(state)).toEqual(['query', 'passage_1', 'passage_2']);
    expect(Object.keys(questions)).toEqual(['relevance_1', 'relevance_2', 'sufficient']);

    expect(result.acceptedPassages.map((p) => p.chunk.id)).toEqual(['c1']);
    expect(result.rejectedCount).toBe(1);
    expect(result.tokensSavedPercent).toBeGreaterThan(0);
    expect(result.sufficiency.isSufficient).toBe(true);
  });

  it('is insufficient when the knowledge is absent', async () => {
    const result = await new AssessUseCase(new JevClient()).execute('宇宙旅行の手当申請フローは？', [CARRY_OVER]);
    expect(result.acceptedPassages).toHaveLength(0);
    expect(result.sufficiency.isSufficient).toBe(false);
  });
});
