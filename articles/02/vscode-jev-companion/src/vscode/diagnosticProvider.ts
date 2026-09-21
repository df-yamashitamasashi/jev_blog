/**
 * VSCode Presentation: Diagnostic Provider
 * Coordinates between VSCode text documents and SecurityDiagnosticUseCase
 */

import * as vscode from "vscode";
import { SecurityDiagnosticUseCase } from "../usecases/securityDiagnosticUseCase";

export class JevDiagnosticProvider {
  private diagnosticCollection: vscode.DiagnosticCollection;

  constructor(
    private readonly securityUseCase: SecurityDiagnosticUseCase
  ) {
    this.diagnosticCollection =
      vscode.languages.createDiagnosticCollection("jev-security");
  }

  setDiagnosticsForRange(
    document: vscode.TextDocument,
    targetRange: vscode.Range,
    results: any[]
  ): void {
    if (results.length === 0) {
      this.diagnosticCollection.delete(document.uri);
      return;
    }

    const diagnostics: vscode.Diagnostic[] = [];
    for (const item of results) {
      const severity =
        item.severity === "error"
          ? vscode.DiagnosticSeverity.Error
          : item.severity === "warning"
          ? vscode.DiagnosticSeverity.Warning
          : vscode.DiagnosticSeverity.Information;

      const diag = new vscode.Diagnostic(targetRange, item.message, severity);
      diag.source = "Jev Security";
      diag.code = item.ruleId;
      diagnostics.push(diag);
    }

    this.diagnosticCollection.set(document.uri, diagnostics);
  }

  async runDiagnostics(document: vscode.TextDocument): Promise<void> {
    const text = document.getText();
    if (!text.trim()) {
      this.diagnosticCollection.delete(document.uri);
      return;
    }

    try {
      const results = await this.securityUseCase.execute({
        codeSnippet: text,
        filePath: document.fileName,
        languageId: document.languageId,
      });

      // 疑わしい行（APIキーやシークレット）があればその行、なければ先頭行
      let targetRange = new vscode.Range(0, 0, 0, 0);
      const lines = text.split("\n");
      const secretLineIndex = lines.findIndex((l) =>
        /key|secret|token|password|api_key/i.test(l) && /["'][^"']+["']/.test(l)
      );
      if (secretLineIndex !== -1) {
        targetRange = new vscode.Range(
          secretLineIndex,
          0,
          secretLineIndex,
          lines[secretLineIndex].length
        );
      } else {
        targetRange = new vscode.Range(0, 0, Math.min(document.lineCount - 1, 1), 0);
      }

      this.setDiagnosticsForRange(document, targetRange, results);
    } catch (err: unknown) {
      console.error("[Jev Diagnostic] Failed to run security diagnostic:", err);
    }
  }

  clear(uri?: vscode.Uri): void {
    if (uri) {
      this.diagnosticCollection.delete(uri);
    } else {
      this.diagnosticCollection.clear();
    }
  }

  dispose(): void {
    this.diagnosticCollection.dispose();
  }
}
