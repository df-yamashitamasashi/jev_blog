/**
 * VSCode Presentation: Code Action Provider (Quick Fixes)
 */

import * as vscode from "vscode";

export class JevCodeActionProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.QuickFix,
  ];

  provideCodeActions(
    _document: vscode.TextDocument,
    _range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    for (const diagnostic of context.diagnostics) {
      if (diagnostic.source === "Jev Security") {
        if (diagnostic.code === "jev-hardcoded_secret") {
          const fix = new vscode.CodeAction(
            "Extract secret to environment variable (process.env)",
            vscode.CodeActionKind.QuickFix
          );
          fix.diagnostics = [diagnostic];
          fix.isPreferred = true;
          actions.push(fix);
        } else if (diagnostic.code === "jev-unhandled_exception") {
          const fix = new vscode.CodeAction(
            "Add defensive logging and re-throw / error handling",
            vscode.CodeActionKind.QuickFix
          );
          fix.diagnostics = [diagnostic];
          fix.isPreferred = true;
          actions.push(fix);
        }
      }
    }

    return actions;
  }
}
