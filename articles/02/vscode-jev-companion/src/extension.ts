/**
 * Jev Companion Extension Entrypoint
 * Bootstraps Clean Architecture layers and wires VSCode events
 */

import * as vscode from "vscode";
import { IJevConfig } from "./adapters/configAdapter";
import { JevHttpClient } from "./adapters/jevClient";
import { SecurityDiagnosticUseCase } from "./usecases/securityDiagnosticUseCase";
import { IntentRoutingUseCase } from "./usecases/intentRoutingUseCase";
import { SpeculativeGateUseCase } from "./usecases/speculativeGateUseCase";
import { JevStatusBarItem } from "./vscode/statusBar";
import { JevDiagnosticProvider } from "./vscode/diagnosticProvider";
import { JevCodeActionProvider } from "./vscode/codeActionProvider";
import { registerCommands } from "./vscode/commands";
import {
  DEFAULT_CONFIDENCE_THRESHOLD,
  DEFAULT_JEV_BASE_URL,
  DEFAULT_JEV_MODEL,
} from "./domain/constants";

class VsCodeJevConfig implements IJevConfig {
  getApiKey(): string {
    const config = vscode.workspace.getConfiguration("jev");
    return (
      config.get<string>("apiKey") ||
      (typeof process !== "undefined" && process.env?.TYPESAFE_API_KEY) ||
      ""
    );
  }

  getBaseUrl(): string {
    return (
      vscode.workspace.getConfiguration("jev").get<string>("baseUrl") ||
      DEFAULT_JEV_BASE_URL
    );
  }

  getModel(): string {
    return (
      vscode.workspace.getConfiguration("jev").get<string>("model") ||
      DEFAULT_JEV_MODEL
    );
  }

  getConfidenceThreshold(): number {
    return (
      vscode.workspace
        .getConfiguration("jev")
        .get<number>("confidenceThreshold") ?? DEFAULT_CONFIDENCE_THRESHOLD
    );
  }

  isDiagnosticOnSaveEnabled(): boolean {
    return (
      vscode.workspace
        .getConfiguration("jev")
        .get<boolean>("enableOnSave") ?? true
    );
  }

  isSpeculativeGateEnabled(): boolean {
    return (
      vscode.workspace
        .getConfiguration("jev")
        .get<boolean>("enableSpeculativeGate") ?? true
    );
  }
}

export function activate(context: vscode.ExtensionContext): void {
  console.log("[Jev Companion] Activating extension...");

  // 1. Initialize Adapters
  const config = new VsCodeJevConfig();
  const jevClient = new JevHttpClient({
    apiKey: config.getApiKey(),
    baseUrl: config.getBaseUrl(),
  });

  // 2. Initialize Use Cases
  const securityUseCase = new SecurityDiagnosticUseCase(jevClient, config);
  const intentUseCase = new IntentRoutingUseCase(jevClient, config);
  const speculativeUseCase = new SpeculativeGateUseCase(jevClient, config);

  // 3. Initialize Presentation Layer
  const statusBar = new JevStatusBarItem();
  const diagnosticProvider = new JevDiagnosticProvider(securityUseCase);

  // 4. Register Commands & Providers
  registerCommands(context, securityUseCase, intentUseCase, statusBar);

  const codeActionDisposable = vscode.languages.registerCodeActionsProvider(
    { scheme: "file" },
    new JevCodeActionProvider(),
    { providedCodeActionKinds: JevCodeActionProvider.providedCodeActionKinds }
  );

  // 5. Register Document Save Listener for Diagnostics
  const saveDisposable = vscode.workspace.onDidSaveTextDocument(
    async (document) => {
      if (!config.isDiagnosticOnSaveEnabled()) {
        return;
      }
      // Apply Speculative Gate to avoid running diagnostics on non-code files
      const gateResult = await speculativeUseCase.execute({
        currentLine: document.lineAt(0)?.text ?? "",
        surroundingSnippet: document.getText().slice(0, 500),
        triggerKind: "save",
      });

      if (gateResult.shouldProceedToLLM) {
        await diagnosticProvider.runDiagnostics(document);
      }
    }
  );

  context.subscriptions.push(
    statusBar,
    diagnosticProvider,
    codeActionDisposable,
    saveDisposable
  );

  console.log("[Jev Companion] Activated successfully.");
}

export function deactivate(): void {
  console.log("[Jev Companion] Deactivated.");
}
