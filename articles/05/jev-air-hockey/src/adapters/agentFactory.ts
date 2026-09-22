/**
 * Agent Client Factory (Clean Architecture - Adapter Layer)
 */

import { AgentType } from "../domain/jevAgentTypes";
import { IAgentClient } from "./agentClient";
import { JevAgentClient } from "./jevAgentClient";
import { GeminiAgentClient } from "./geminiAgentClient";
import { ClaudeAgentClient } from "./claudeAgentClient";
import { CpuAgentClient } from "./cpuAgentClient";

const API_KEY_STORAGE: Partial<Record<AgentType, string>> = {
  [AgentType.JEV]: "jev_api_key",
  [AgentType.GEMINI]: "gemini_api_key",
  [AgentType.CLAUDE]: "claude_api_key",
};

export class AgentFactory {
  static createClient(type: AgentType): IAgentClient | null {
    switch (type) {
      case AgentType.CPU:
        return new CpuAgentClient();
      case AgentType.JEV:
        return new JevAgentClient();
      case AgentType.GEMINI:
        return new GeminiAgentClient();
      case AgentType.CLAUDE:
        return new ClaudeAgentClient();
      case AgentType.HUMAN:
      default:
        return null;
    }
  }

  static hasApiKey(type: AgentType): boolean {
    if (type === AgentType.CPU || type === AgentType.HUMAN) return true;

    const storageKey = API_KEY_STORAGE[type];
    if (!storageKey || typeof window === "undefined") return false;

    try {
      return !!localStorage.getItem(storageKey);
    } catch {
      return false;
    }
  }

  /** ベンチマークに参加できるエージェント (キー未設定のものは除外) */
  static availableAgents(): AgentType[] {
    return [AgentType.CPU, AgentType.JEV, AgentType.GEMINI, AgentType.CLAUDE].filter((t) =>
      AgentFactory.hasApiKey(t)
    );
  }
}
