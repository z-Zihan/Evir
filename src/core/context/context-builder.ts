import type { InteractionMode } from "../providers/tool-registry";
import type { ContextBudgetSnapshot, ContextCompressionStage } from "./types";

export interface ContextBuilderPort {
  build(input: {
    conversationId: string;
    mode: InteractionMode;
    userMessage: string;
    recentMessages: unknown[];
    activeSkills: string[];
    memoryIds: string[];
    toolResults: unknown[];
  }): Promise<{ systemPrompt: string; contextTokens: number }>;
}

export interface ContextBudgetManager {
  snapshot(
    modelId: string,
    maxContextTokens: number,
    estimatedInputTokens: number,
  ): ContextBudgetSnapshot;
  shouldCompact(snapshot: ContextBudgetSnapshot): boolean;
  getCompressionStage(utilization: number): ContextCompressionStage;
}
