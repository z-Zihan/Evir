import type { ContextBudgetManager } from "./context-builder";
import type { ContextCompressionStage } from "./types";

const SAFETY_MARGIN_RATIO = 0.1;
const RESERVED_OUTPUT_RATIO = 0.2;
const RESERVED_TOOLS_RATIO = 0.1;

export function createContextBudgetManager(): ContextBudgetManager {
  return {
    snapshot(modelId, maxContextTokens, estimatedInputTokens) {
      const safetyMarginTokens = Math.floor(maxContextTokens * SAFETY_MARGIN_RATIO);
      const reservedOutputTokens = Math.floor(maxContextTokens * RESERVED_OUTPUT_RATIO);
      const reservedToolTokens = Math.floor(maxContextTokens * RESERVED_TOOLS_RATIO);
      const availableTokens =
        maxContextTokens - safetyMarginTokens - reservedOutputTokens - reservedToolTokens;
      const utilizationRatio = availableTokens > 0 ? estimatedInputTokens / availableTokens : 1;
      const compressionStage = getCompressionStage(utilizationRatio);

      return {
        modelId,
        maxContextTokens,
        estimatedInputTokens,
        reservedOutputTokens,
        reservedToolTokens,
        safetyMarginTokens,
        utilizationRatio,
        compressionStage,
      };
    },

    shouldCompact(snapshot) {
      return snapshot.utilizationRatio > 0.6;
    },

    getCompressionStage: getCompressionStage,
  };
}

export function getCompressionStage(utilization: number): ContextCompressionStage {
  if (utilization > 0.9) return "checkpoint-compaction";
  if (utilization > 0.75) return "conversation-summary";
  if (utilization > 0.6) return "tool-output-compaction";
  return "none";
}
