import type { ContextBudgetManager } from "./context-builder";
import type { ContextCompressionStage } from "./types";

const SAFETY_MARGIN_RATIO = 0.1;
const RESERVED_OUTPUT_RATIO = 0.2;
const RESERVED_TOOLS_RATIO = 0.1;
const COMPACT_THRESHOLD = 0.6;
const SUMMARY_THRESHOLD = 0.75;
const CHECKPOINT_THRESHOLD = 0.9;

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
      return snapshot.utilizationRatio > COMPACT_THRESHOLD;
    },

    getCompressionStage: getCompressionStage,
  };
}

export function getCompressionStage(utilization: number): ContextCompressionStage {
  if (utilization > CHECKPOINT_THRESHOLD) return "checkpoint-compaction";
  if (utilization > SUMMARY_THRESHOLD) return "conversation-summary";
  if (utilization > COMPACT_THRESHOLD) return "tool-output-compaction";
  return "none";
}
