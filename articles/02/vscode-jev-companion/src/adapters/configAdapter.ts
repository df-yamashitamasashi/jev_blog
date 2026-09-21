/**
 * Configuration Adapter
 * Decouples domain and use case layers from VSCode workspace configuration
 */

import {
  DEFAULT_CONFIDENCE_THRESHOLD,
  DEFAULT_JEV_BASE_URL,
  DEFAULT_JEV_MODEL,
} from "../domain/constants";

export interface IJevConfig {
  getApiKey(): string;
  getBaseUrl(): string;
  getModel(): string;
  getConfidenceThreshold(): number;
  isDiagnosticOnSaveEnabled(): boolean;
  isSpeculativeGateEnabled(): boolean;
}

export class MockJevConfig implements IJevConfig {
  constructor(
    private readonly config: {
      apiKey?: string;
      baseUrl?: string;
      model?: string;
      confidenceThreshold?: number;
      enableOnSave?: boolean;
      enableSpeculativeGate?: boolean;
    } = {}
  ) {}

  getApiKey(): string {
    return this.config.apiKey ?? "";
  }
  getBaseUrl(): string {
    return this.config.baseUrl ?? DEFAULT_JEV_BASE_URL;
  }
  getModel(): string {
    return this.config.model ?? DEFAULT_JEV_MODEL;
  }
  getConfidenceThreshold(): number {
    return this.config.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  }
  isDiagnosticOnSaveEnabled(): boolean {
    return this.config.enableOnSave ?? true;
  }
  isSpeculativeGateEnabled(): boolean {
    return this.config.enableSpeculativeGate ?? true;
  }
}
