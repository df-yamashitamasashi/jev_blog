/**
 * UseCase: Gate 1 & Gate 2 - Query Intent Triage, Routing & Query Decomposition
 *
 * 3つの質問（intent / route / decompose）を1回の Jev 呼び出しにまとめて判定する。
 */

import { JevClient } from '../adapters/jevClient';
import { Choice, ChoiceAnswer, Noul, NoulAnswer } from '../domain/jevPrimitives';
import { QueryTriageResult, TriageIntent } from '../domain/models';
import { splitTopics } from '../domain/textSimilarity';

const ROUTE_CONFIDENCE_THRESHOLD = 0.6;
const DECOMPOSE_THRESHOLD = 0.75;

export class TriageUseCase {
  constructor(private jevClient: JevClient) {}

  async execute(query: string): Promise<QueryTriageResult> {
    const intent: Choice = {
      type: 'choice',
      instructions:
        'ユーザーの入力 query は、社内ドキュメントの検索が必要ですか？それとも単なる挨拶や雑談、あるいは情報が不足して確認が必要ですか？',
      criteria: {
        direct_answer: '挨拶、お礼、一般的な日常会話など、ドキュメント検索が不要な入力',
        knowledge_search: '社内就業規程、API仕様、サービス仕様、FAQなどの知識検索を求める具体的な質問',
        clarification_needed: '質問が抽象的・曖昧すぎる、あるいは代名詞のみで文脈が不足しており、ユーザーに聞き返す必要がある入力',
      },
    };
    const route: Choice = {
      type: 'choice',
      instructions: '`query` に答えるには、どのカテゴリのドキュメントを検索すべきですか？',
      criteria: {
        hr: '就業規程、休暇、手当、在宅勤務など人事・労務に関する質問',
        api: 'API仕様、認証、トークン、レート制限など技術仕様に関する質問',
        faq: '契約、解約、返金、データのバックアップなど顧客向けFAQに関する質問',
        general: '上記のいずれにも明確に当てはまらない質問',
      },
    };
    const decompose: Noul = {
      type: 'noul',
      instructions:
        '`query` には複数のエンティティや異なるトピックの比較・複合質問が含まれており、単一の検索クエリではなく複数の検索キーワードに分解する必要がありますか？',
    };

    const response = await this.jevClient.systemOne({
      state: { query },
      questions: { intent, route, decompose },
    });

    const intentAns = response.answers['intent'] as ChoiceAnswer;
    const routeAns = response.answers['route'] as ChoiceAnswer | undefined;
    const decompAns = response.answers['decompose'] as NoulAnswer;

    const resolvedIntent = (intentAns?.choice as TriageIntent) || 'knowledge_search';
    const needsDecomposition = decompAns ? decompAns.noul >= DECOMPOSE_THRESHOLD : false;

    // 確信度が低いルーティングは誤った絞り込みの原因になるため、全カテゴリ検索にフォールバックする
    const targetCategory =
      routeAns && routeAns.choice !== 'general' && routeAns.confidence >= ROUTE_CONFIDENCE_THRESHOLD
        ? routeAns.choice
        : undefined;

    // 分解が必要と判定された場合のみ、接続詞（と/及び/、）で区切ってサブクエリを作る。
    // 「分解すべきか」は Jev が判定し、「どう分解するか」はルールで行う。
    const subQueries: string[] = [query];
    if (needsDecomposition) {
      subQueries.push(...splitTopics(query).filter((t) => t !== query).slice(0, 3));
    }

    return {
      intent: resolvedIntent,
      targetCategory,
      answer: intentAns,
      routeAnswer: routeAns,
      needsDecomposition,
      decompositionNoul: decompAns,
      subQueries,
      latencyMs: response.latencyMs,
    };
  }
}
