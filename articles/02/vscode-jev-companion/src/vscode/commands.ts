/**
 * VSCode Presentation: Commands
 * Handlers for VSCode command palette and keyboard shortcuts
 */

import * as vscode from "vscode";
import { SecurityDiagnosticUseCase } from "../usecases/securityDiagnosticUseCase";
import { IntentRoutingUseCase } from "../usecases/intentRoutingUseCase";
import { JevStatusBarItem } from "./statusBar";

export function registerCommands(
  context: vscode.ExtensionContext,
  securityUseCase: SecurityDiagnosticUseCase,
  intentUseCase: IntentRoutingUseCase,
  statusBar: JevStatusBarItem
): void {
  // Command 1: Analyze Selected Code (Security & Quality)
  const analyzeCmd = vscode.commands.registerCommand(
    "jev.analyzeSelection",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage("No active editor found.");
        return;
      }

      const selection = editor.selection;
      const code = editor.document.getText(selection.isEmpty ? undefined : selection);
      if (!code.trim()) {
        vscode.window.showWarningMessage("Please select some code to analyze.");
        return;
      }

      statusBar.setAnalyzing();
      const startTime = performance.now();

      try {
        const diagnostics = await securityUseCase.execute({
          codeSnippet: code,
          filePath: editor.document.fileName,
          languageId: editor.document.languageId,
        });

        const latency = Math.round(performance.now() - startTime);

        if (diagnostics.length === 0) {
          statusBar.setResult("Safe", 0.95, latency);
          vscode.window.showInformationMessage(
            `$(check) Jev System One: No security or quality risks detected. (${latency}ms)`
          );
        } else {
          const first = diagnostics[0];
          statusBar.setResult(first.ruleId, first.confidence, latency);
          vscode.window.showWarningMessage(
            `${first.message} (${latency}ms)`
          );
        }
      } catch (err: unknown) {
        statusBar.setIdle();
        vscode.window.showErrorMessage(
          `Jev analysis failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  );

  // Command 2: Smart Intent Dispatcher
  const routeCmd = vscode.commands.registerCommand("jev.routeIntent", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showInformationMessage("No active editor found.");
      return;
    }

    const selection = editor.selection;
    const code = editor.document.getText(selection.isEmpty ? undefined : selection);
    if (!code.trim()) {
      vscode.window.showWarningMessage("Please select code to determine developer intent.");
      return;
    }

    statusBar.setAnalyzing();
    const startTime = performance.now();

    try {
      const result = await intentUseCase.execute({
        selectedCode: code,
        languageId: editor.document.languageId,
      });

      const latency = Math.round(performance.now() - startTime);
      statusBar.setResult(result.primaryIntent, result.confidence, latency);

      // Present quick pick options with probability distribution
      const items: vscode.QuickPickItem[] = Object.entries(result.probabilities).map(
        ([intent, prob]) => {
          const isPrimary = intent === result.primaryIntent;
          return {
            label: `${isPrimary ? "★ " : ""}${intent}`,
            description: `Prob: ${(prob * 100).toFixed(1)}% | Tier: ${result.targetModelTier}`,
            detail: isPrimary ? "Jev top recommendation" : undefined,
          };
        }
      );

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: `Jev recommendation: ${result.primaryIntent} (Confidence: ${(
          result.confidence * 100
        ).toFixed(1)}%, ${latency}ms). Select action to dispatch:`,
      });

      if (picked) {
        await vscode.env.clipboard.writeText(result.recommendedPromptTemplate);
        vscode.window.showInformationMessage(
          `Copied recommended prompt for '${picked.label.replace("★ ", "")}' to clipboard.`
        );
      }
    } catch (err: unknown) {
      statusBar.setIdle();
      vscode.window.showErrorMessage(
        `Jev intent routing failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  });

  context.subscriptions.push(analyzeCmd, routeCmd);
}
