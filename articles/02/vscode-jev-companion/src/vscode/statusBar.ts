/**
 * VSCode Presentation: Status Bar Item
 * Displays the status and recent decision metrics of Jev System One
 */

import * as vscode from "vscode";

export class JevStatusBarItem {
  private statusBarItem: vscode.StatusBarItem;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.statusBarItem.command = "jev.routeIntent";
    this.setIdle();
    this.statusBarItem.show();
  }

  setIdle(): void {
    this.statusBarItem.text = "$(sparkle) Jev: Ready";
    this.statusBarItem.tooltip = "Jev System One is ready for decisions.";
  }

  setAnalyzing(): void {
    this.statusBarItem.text = "$(sync~spin) Jev: Deciding...";
    this.statusBarItem.tooltip = "Evaluating code with Jev System One...";
  }

  setResult(intent: string, confidence: number, latencyMs: number): void {
    const confPercent = (confidence * 100).toFixed(0);
    this.statusBarItem.text = `$(check) Jev: ${intent} (${confPercent}%, ${latencyMs}ms)`;
    this.statusBarItem.tooltip = `Last Decision: ${intent}\nConfidence: ${confPercent}%\nLatency: ${latencyMs}ms\nClick to change intent or run action.`;
  }

  dispose(): void {
    this.statusBarItem.dispose();
  }
}
