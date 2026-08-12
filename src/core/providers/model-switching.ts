import type { ModelHandoffCheckpoint } from "../context/types";
import type { MessageRecord } from "../storage/db";
import type { InteractionMode } from "./tool-registry";

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
  privateSession?: boolean;
  runId?: string;
  fromProviderId: string;
  fromModelId: string;
  toProviderId: string;
  toModelId: string;
  requestedAt: number;
  mode: InteractionMode;
  hasActiveExecution?: boolean;
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

export interface ModelSwitchResult {
  status: ModelSwitchStatus;
  handoffMessage?: MessageRecord;
}
