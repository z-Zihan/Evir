import type { InteractionMode } from "../providers/tool-registry";
import type { ContextBudgetSnapshot, ContextCompressionStage } from "./types";
import type { FileContextReference } from "./types";
import { estimateTokens } from "./token-estimate";

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

export interface ContextBuildSections {
  modeRules?: string;
  runCapsule?: string;
  activeSkills?: string;
  skillRouting?: string;
  memory?: string;
  personalization?: string;
  fileReferences?: FileContextReference[];
}

export class ContextBuilderImpl {
  buildSystemPrompt(sections: ContextBuildSections): {
    systemPrompt: string;
    contextTokens: number;
  } {
    const parts: string[] = [];
    if (sections.modeRules) parts.push(sections.modeRules);
    if (sections.runCapsule) parts.push(`<run_state>\n${sections.runCapsule}\n</run_state>`);
    if (sections.fileReferences?.length) {
      const references = sections.fileReferences
        .map(
          ({ path, contentHash, lastReadAt, summary, stale }) =>
            `- ${path} | hash=${contentHash ?? "unknown"} | read=${new Date(lastReadAt).toISOString()} | stale=${stale} | ${summary}`,
        )
        .join("\n");
      parts.push(`<file_references>\n${references}\n</file_references>`);
    }
    if (sections.activeSkills)
      parts.push(`<active_skills>\n${sections.activeSkills}\n</active_skills>`);
    if (sections.skillRouting)
      parts.push(`<skill_routing>\n${sections.skillRouting}\n</skill_routing>`);
    if (sections.memory) parts.push(`<memory>\n${sections.memory}\n</memory>`);
    if (sections.personalization) {
      parts.push(`<personalization>\n${sections.personalization}\n</personalization>`);
    }
    const systemPrompt = parts.join("\n\n");
    return { systemPrompt, contextTokens: estimateTokens(systemPrompt) };
  }
}

export const contextBuilder = new ContextBuilderImpl();

export interface ContextBudgetManager {
  snapshot(
    modelId: string,
    maxContextTokens: number,
    estimatedInputTokens: number,
  ): ContextBudgetSnapshot;
  shouldCompact(snapshot: ContextBudgetSnapshot): boolean;
  getCompressionStage(utilization: number): ContextCompressionStage;
}
