import { describe, expect, it } from 'vitest';
import { InMemoryRetriever } from '../src/adapters/inMemoryRetriever';

describe('InMemoryRetriever', () => {
  const retriever = new InMemoryRetriever();

  it('should produce non-zero BM25 scores for Japanese queries', () => {
    const results = retriever.search('有給休暇の繰り越し上限は何日ですか？', 5);
    expect(results[0].chunk.id).toBe('hr_01_c2');
    expect(results[0].bm25Score).toBeGreaterThan(0);
  });

  it('should always include user-added custom documents regardless of routing', () => {
    retriever.addDocument({
      id: 'custom_1',
      title: '出張規程',
      category: 'custom',
      content: '国内出張の日当は1日あたり3,000円を支給します。宿泊費は1泊12,000円を上限とします。',
    });
    const results = retriever.search('出張の日当はいくらですか？', 5, 'hr');
    expect(results.some((r) => r.chunk.docId === 'custom_1')).toBe(true);
  });
});
