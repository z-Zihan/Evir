import type { ModelHandoffCheckpoint } from "../context/types";

export type ModelSwitchStatus =
  | "idle"
  | "validating-target-model"
  | "checking-capabilities"
  | "checking-context-budget"
  | "creating-handoff-checkpoint"
  | "requires-confirmation"
  | "blocked"
  | "switched"
  | "rolled-back";

export type ModelSwitchBlockReason =
  | "active-tool-execution"
  | "tool-calling-unsupported"
  | "context-overflow"
  | "attachment-unsupported"
  | "provider-state-incompatible"
  | "missing-credentials"
  | "target-model-unavailable";

export interface ModelSwitchRequest {
  conversationId: string;
  runId?: string;
  fromProviderId: string;
  fromModelId: string;
  toProviderId: string;
  toModelId: string;
  requestedAt: number;
}

export interface ModelSwitchAssessment {
  status: ModelSwitchStatus;
  requiresDataDestinationConfirmation: boolean;
  requiresModeDowngrade: boolean;
  requiresContextCompaction: boolean;
  blockReason?: ModelSwitchBlockReason;
  handoff?: ModelHandoffCheckpoint;
  warnings: string[];
}
