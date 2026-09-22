/**
 * Document Manager Component
 * Displays and allows dynamic addition of documents to the in-memory knowledge base.
 */

import { InMemoryRetriever } from '../adapters/inMemoryRetriever';
import { KnowledgeDocument } from '../domain/models';

export class DocumentManager {
  private container: HTMLElement;

  constructor(containerId: string, private retriever: InMemoryRetriever) {
    const el = document.getElementById(containerId);
    if (!el) throw new Error(`Element #${containerId} not found`);
    this.container = el;
    this.render();
  }

  render(): void {
    const docs = this.retriever.getDocuments();
    const chunks = this.retriever.getChunks();

    this.container.innerHTML = `
      <div class="docs-panel-header">
        <div class="docs-count-info">
          <span>📚 ナレッジベース</span>
          <span class="counts-badge">${docs.length} 件 (${chunks.length} チャンク)</span>
        </div>
        <button id="btn-add-doc" class="btn-ghost-sm">+ ドキュメント追加</button>
      </div>

      <div class="docs-list">
        ${docs
          .map(
            (d) => `
          <div class="doc-card" id="doc-${d.id}">
            <div class="doc-card-header">
              <span class="doc-category-badge cat-${d.category}">${d.category.toUpperCase()}</span>
              <span class="doc-title">${this.escapeHtml(d.title)}</span>
            </div>
            <div class="doc-preview">
              ${this.escapeHtml(d.content.slice(0, 100))}...
            </div>
          </div>
        `
          )
          .join('')}
      </div>
    `;

    document.getElementById('btn-add-doc')?.addEventListener('click', () => {
      this.promptAddDocument();
    });
  }

  private promptAddDocument(): void {
    const title = prompt('追加するドキュメントのタイトルを入力してください:');
    if (!title) return;

    const content = prompt('ドキュメントの本文を入力してください（段落区切り可）:');
    if (!content) return;

    const newDoc: KnowledgeDocument = {
      id: `custom_${Date.now()}`,
      title,
      category: 'custom',
      content,
    };

    this.retriever.addDocument(newDoc);
    this.render();
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
