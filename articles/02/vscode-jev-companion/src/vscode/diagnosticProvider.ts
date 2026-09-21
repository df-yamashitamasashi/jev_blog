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

      const diagnostics: vscode.Diagnostic[] = [];

      for (const item of results) {
        // Map to document range (first line if full-document analysis)
        const range = new vscode.Range(0, 0, Math.min(document.lineCount - 1, 2), 0);
        const severity =
          item.severity === "error"
            ? vscode.DiagnosticSeverity.Error
            : item.severity === "warning"
            ? vscode.DiagnosticSeverity.Warning
            : vscode.DiagnosticSeverity.Information;

        const diag = new vscode.Diagnostic(range, item.message, severity);
        diag.source = "Jev Security";
        diag.code = item.ruleId;
        diagnostics.push(diag);
      }

      this.diagnosticCollection.set(document.uri, diagnostics);
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
