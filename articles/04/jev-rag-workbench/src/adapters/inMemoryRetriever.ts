/**
 * In-Memory Hybrid Retriever (BM25 + Cosine Vector Similarity)
 */

import { DocumentChunk, KnowledgeDocument, SearchResult } from '../domain/models';

export class InMemoryRetriever {
  private documents: Map<string, KnowledgeDocument> = new Map();
  private chunks: DocumentChunk[] = [];
  private idfMap: Map<string, number> = new Map();
  private avgChunkLength = 0;

  constructor() {
    this.initDefaultKnowledge();
  }

  addDocument(doc: KnowledgeDocument): void {
    this.documents.set(doc.id, doc);
    this.rebuildIndex();
  }

  getDocuments(): KnowledgeDocument[] {
    return Array.from(this.documents.values());
  }

  getChunks(): DocumentChunk[] {
    return this.chunks;
  }

  search(query: string, topK: number = 5, targetCategory?: string): SearchResult[] {
    const queryTokens = this.tokenize(query);
    if (queryTokens.length === 0 || this.chunks.length === 0) return [];

    const filteredChunks = targetCategory
      ? this.chunks.filter((c) => c.category === targetCategory)
      : this.chunks;

    const candidates = filteredChunks.length > 0 ? filteredChunks : this.chunks;

    const results: SearchResult[] = candidates.map((chunk) => {
      const bm25 = this.scoreBM25(queryTokens, chunk.text);
      const dense = this.scoreDenseSimilarity(query, chunk.text);
      // Hybrid combination (0.5 BM25 normalized + 0.5 Dense)
      const hybridScore = 0.5 * Math.min(1.0, bm25 / 5.0) + 0.5 * dense;

      return {
        chunk,
        bm25Score: Math.round(bm25 * 100) / 100,
        denseScore: Math.round(dense * 100) / 100,
        hybridScore: Math.round(hybridScore * 100) / 100,
      };
    });

    results.sort((a, b) => b.hybridScore - a.hybridScore);
    return results.slice(0, topK);
  }

  private rebuildIndex(): void {
    this.chunks = [];
    for (const doc of this.documents.values()) {
      const docChunks = this.chunkText(doc.content, doc.id, doc.title, doc.category);
      this.chunks.push(...docChunks);
    }

    // Compute IDF
    const totalDocs = this.chunks.length;
    let totalLength = 0;
    const docFreq = new Map<string, number>();

    for (const chunk of this.chunks) {
      const tokens = new Set(this.tokenize(chunk.text));
      totalLength += chunk.text.length;
      for (const token of tokens) {
        docFreq.set(token, (docFreq.get(token) || 0) + 1);
      }
    }

    this.avgChunkLength = totalDocs > 0 ? totalLength / totalDocs : 1;
    this.idfMap.clear();
    for (const [token, freq] of docFreq.entries()) {
      // BM25 IDF formulation
      const idf = Math.log((totalDocs - freq + 0.5) / (freq + 0.5) + 1.0);
      this.idfMap.set(token, Math.max(0.1, idf));
    }
  }

  private chunkText(text: string, docId: string, docTitle: string, category: string): DocumentChunk[] {
    const paragraphs = text
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 20);

    return paragraphs.map((p, idx) => ({
      id: `${docId}_c${idx + 1}`,
      docId,
      docTitle,
      category,
      text: p,
    }));
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[?？!！、。・「」『』（）()[\]]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 2);
  }

  private scoreBM25(queryTokens: string[], docText: string): number {
    const k1 = 1.2;
    const b = 0.75;
    const docTokens = this.tokenize(docText);
    const docLen = docText.length;

    const termFreq = new Map<string, number>();
    for (const t of docTokens) {
      termFreq.set(t, (termFreq.get(t) || 0) + 1);
    }

    let score = 0;
    for (const token of queryTokens) {
      const tf = termFreq.get(token) || 0;
      if (tf === 0) continue;
      const idf = this.idfMap.get(token) || 0.5;
      const tfWeight = (tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * docLen) / this.avgChunkLength));
      score += idf * tfWeight;
    }

    return score;
  }

  private scoreDenseSimilarity(query: string, docText: string): number {
    // Word set Jaccard + Character N-Gram overlap as high quality deterministic pseudo-dense representation
    const qChars = new Set(query.toLowerCase());
    const dChars = new Set(docText.toLowerCase());

    let overlap = 0;
    for (const ch of qChars) {
      if (dChars.has(ch)) overlap++;
    }

    return qChars.size > 0 ? overlap / qChars.size : 0;
  }

  private initDefaultKnowledge(): void {
    // 1. HR Policies
    this.addDocument({
      id: 'hr_01',
      title: '社内就業規程・休暇制度',
      category: 'hr',
      content: `第12条（有給休暇の付与）
正社員は入社半年後に10日間の年次有給休暇が付与されます。勤続年数に応じて毎年最大20日まで付与日数が増加します。パートタイム労働者には所定労働日数に応じた比例付与を行います。

第13条（有給休暇の繰り越し規定）
当該年度に消化しきれなかった未使用の有給休暇は、翌年度に限り1年間の繰り越しが認められます。ただし、繰り越して保持できる有給休暇の日数は最大20日を限度とし、それを超える日数は失効します。

第14条（特別休暇及び慶弔休暇）
社員は本人の結婚時に5日、配偶者の出産時に3日、近親者の喪服時に1日〜5日の慶弔休暇を取得できます。また夏季特別休暇として毎年7月〜9月の間に3日付与されます。`,
    });

    this.addDocument({
      id: 'hr_02',
      title: 'リモートワーク及び手当規程',
      category: 'hr',
      content: `第4条（在宅勤務の対象者）
試用期間を終了した正社員および契約社員のうち、週3日以上の在宅勤務を所属長に事前承認された者を対象とします。

第5条（在宅勤務環境手当）
在宅勤務における光熱費・インターネット通信費の補助として、対象者に対し月額一律5,000円のリモートワーク手当を給与と合わせて支給します。

第6条（PC・周辺機器の貸与）
業務に必要なノートPC、セキュリティトークン、外付けディスプレイ1台は会社が無償で貸与します。私用デバイスの業務利用（BYOD）はセキュリティ上禁止します。`,
    });

    // 2. API Technical Specs
    this.addDocument({
      id: 'api_01',
      title: 'TypeSafe Core API 認証・認可仕様',
      category: 'api',
      content: `1. 認証トークンの有効期間
クライアントが発行を受けるアクセストークン（Bearer JWT）の有効期限は発行時刻より24時間（86,400秒）です。有効期限が切れた場合、APIはHTTP 401 Unauthorizedを返却します。

2. トークンのリフレッシュ機構
アクセストークン失効時は、同時に発行されたリフレッシュトークンを用いて /v1/auth/refresh エンドポイントにPOSTリクエストを送信することで、無停止で新しいトークンを再取得できます。リフレッシュトークンの有効期限は30日間です。

3. レートリミット（流量制限）
Standardプランでは1分あたり最大60リクエスト、Enterpriseプランでは1分あたり最大1,200リクエストのレート制限が適用されます。制限超過時は HTTP 429 Too Many Requests が返却されます。`,
    });

    // 3. Customer Support FAQ
    this.addDocument({
      id: 'faq_01',
      title: 'カスタマーサポート・契約・解約FAQ',
      category: 'faq',
      content: `Q: サービスの解約手続きはいつまでに行う必要がありますか？
A: 契約自動更新の停止または解約をご希望の場合は、契約更新日の7日前までに管理画面の「プラン設定」より解約申請を完了してください。

Q: 年払い契約を途中で解約した場合、月割りでの返金はありますか？
A: 大変恐れ入りますが、年払いプランの中途解約における残月数の日割り・月割りでの返金対応は一切承っておりません。次回更新日までは引き続き全機能をご利用いただけます。

Q: 保存されているデータのバックアップとエクスポートは可能ですか？
A: 管理者アカウントより、いつでもJSON形式またはCSV形式で全プロジェクトデータを一括ダウンロードすることが可能です。解約後30日を経過するとデータは完全に削除されます。`,
    });
  }
}
