/**
 * UseCase: Gate 1 & Gate 2 - Query Intent Triage, Routing & Query Decomposition
 */

import { JevClient } from '../adapters/jevClient';
import { Choice, ChoiceAnswer, Noul, NoulAnswer } from '../domain/jevPrimitives';
import { QueryTriageResult, TriageIntent } from '../domain/models';

export class TriageUseCase {
  constructor(private jevClient: JevClient) {}

  async execute(query: string): Promise<QueryTriageResult> {
    const questions = {
      intent: {
        instructions:
          'ユーザーの入力 query は、社内ドキュメントの検索が必要ですか？それとも単なる挨拶や雑談、あるいは情報が不足して確認が必要ですか？',
        criteria: {
          direct_answer: '挨拶、お礼、一般的な日常会話など、ドキュメント検索が不要な入力',
          knowledge_search: '社内就業規程、API仕様、サービス仕様、FAQなどの知識検索を求める具体的な質問',
          clarification_needed: '質問が抽象的・曖昧すぎる、あるいは代名詞のみで文脈が不足しており、ユーザーに聞き返す必要がある入力',
        },
      } as Choice,
      decompose: {
        instructions:
          '`query` には複数のエンティティや異なるトピックの比較・複合質問が含まれており、単一の検索クエリではなく複数の検索キーワードに分解する必要がありますか？',
      } as Noul,
    };

    const response = await this.jevClient.systemOne({
      state: { query },
      questions,
    });

    const intentAns = response.answers['intent'] as ChoiceAnswer;
    const decompAns = response.answers['decompose'] as NoulAnswer;

    const intent = (intentAns?.choice as TriageIntent) || 'knowledge_search';
    const needsDecomposition = decompAns ? decompAns.noul >= 0.75 : false;

    // Route to category if knowledge search
    let targetCategory: string | undefined = undefined;
    const lowerQ = query.toLowerCase();
    if (lowerQ.includes('有給') || lowerQ.includes('休暇') || lowerQ.includes('手当') || lowerQ.includes('リモート')) {
      targetCategory = 'hr';
    } else if (lowerQ.includes('api') || lowerQ.includes('トークン') || lowerQ.includes('リミット') || lowerQ.includes('認証')) {
      targetCategory = 'api';
    } else if (lowerQ.includes('解約') || lowerQ.includes('返金') || lowerQ.includes('バックアップ') || lowerQ.includes('faq')) {
      targetCategory = 'faq';
    }

    // Sub queries generation if needed
    const subQueries: string[] = [query];
    if (needsDecomposition && (query.includes('違い') || query.includes('比較'))) {
      const parts = query.split(/[と及び、\s]+/);
      if (parts.length >= 2) {
        subQueries.push(...parts.filter((p) => p.length >= 2).slice(0, 3));
      }
    }

    return {
      intent,
      targetCategory,
      answer: intentAns,
      needsDecomposition,
      decompositionNoul: decompAns,
      subQueries,
      latencyMs: response.latencyMs,
    };
  }
}
