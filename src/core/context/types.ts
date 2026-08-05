export type ContextCompressionStage =
  "none" | "tool-output-compaction" | "conversation-summary" | "checkpoint-compaction";

export interface ContextBudgetSnapshot {
  modelId: string;
  maxContextTokens: number;
  estimatedInputTokens: number;
  reservedOutputTokens: number;
  reservedToolTokens: number;
  safetyMarginTokens: number;
  utilizationRatio: number;
  compressionStage: ContextCompressionStage;
}

export interface FileContextReference {
  path: string;
  contentHash?: string;
  lastReadAt: number;
  relevantRanges?: Array<{
    startLine: number;
    endLine: number;
  }>;
  summary: string;
  stale: boolean;
}

export interface ModelHandoffCheckpoint {
  objective: string;
  mode: "ask" | "plan" | "agent";
  completedSteps: string[];
  currentStep?: string;
  pendingSteps: string[];
  userConstraints: string[];
  approvals: string[];
  changedArtifacts: string[];
  verificationEvidence: string[];
  unresolvedErrors: string[];
  relevantMemoryIds: string[];
  contextSummaryVersion: string;
}
