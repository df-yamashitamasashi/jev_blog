/**
 * UseCase: System Two - Grounded Generation
 */

import { LLMClient, LLMResponse } from '../adapters/llmClient';
import { RerankedPassage } from '../domain/models';

export class GeneratorUseCase {
  constructor(private llmClient: LLMClient) {}

  async execute(query: string, passages: RerankedPassage[]): Promise<LLMResponse> {
    const context = passages
      .map((p, idx) => `[引用元${idx + 1}: ${p.chunk.docTitle}]\n${p.chunk.text}`)
      .join('\n\n');

    return this.llmClient.generate({ query, context });
  }
}
