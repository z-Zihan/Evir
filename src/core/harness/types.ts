import type { ContextBudgetSnapshot, ContextCompressionStage } from "../context/types";
import type { InteractionMode } from "../providers/tool-registry";
import type { MessageRecord, ToolResultRecord } from "../storage/db";
import type { InstalledSkill } from "../skills/types";
import type { MemoryRecord } from "../memory/types";
import type { StoragePort } from "../storage/storage-port";
import type { VerificationEvidence } from "../tools/verification-evidence";

export type HarnessMiddlewareId =
  | "input-normalization"
  | "mode-policy"
  | "capability-gate"
  | "context-budget"
  | "skill-routing"
  | "memory-retrieval"
  | "tool-policy"
  | "loop-detection"
  | "checkpoint"
  | "verification"
  | "observability";

export const HARNESS_MIDDLEWARE_ORDER: readonly HarnessMiddlewareId[] = [
  "input-normalization",
  "mode-policy",
  "capability-gate",
  "context-budget",
  "skill-routing",
  "memory-retrieval",
  "tool-policy",
  "loop-detection",
  "checkpoint",
  "verification",
  "observability",
];

interface HarnessEventBase {
  conversationId: string;
  runId?: string;
}

export interface HarnessRequestEvent extends HarnessEventBase {
  type: "request";
  target: "web" | "desktop";
  requestedMode: InteractionMode;
  effectiveMode: InteractionMode;
  providerToolCalling: boolean;
  userInput: string;
  normalizedInput: string;
  blocked: boolean;
  blockReason?: string;
}

export interface HarnessContextBudgetEvent extends HarnessEventBase {
  type: "context-budget";
  modelId: string;
  maxContextTokens: number;
  estimatedInputTokens: number;
  snapshot?: ContextBudgetSnapshot;
}

export interface HarnessSkillRoutingEvent extends HarnessEventBase {
  type: "skill-routing";
  mode: InteractionMode;
  userInput: string;
  skills: InstalledSkill[];
  enabledSkillIds: ReadonlySet<string>;
  matchedSkillIds: string[];
  matchReasons: Record<string, string[]>;
}

export interface HarnessMemoryRetrievalEvent extends HarnessEventBase {
  type: "memory-retrieval";
  storage: StoragePort;
  workspacePath: string | null;
  query: string;
  maxCharacters: number;
  context: string;
  memories: MemoryRecord[];
  memoryIds: string[];
}

export interface HarnessToolCallEvent extends HarnessEventBase {
  type: "tool-call";
  phase: "before-execute" | "after-execute" | "run-end";
  mode: InteractionMode;
  toolName?: string;
  arguments?: Record<string, unknown>;
  result?: ToolResultRecord;
  allowedToolIds: ReadonlySet<string>;
  blocked: boolean;
  blockReason?: string;
  loopSignal?: LoopDetectionSignal;
}

export interface HarnessCheckpointEvent extends HarnessEventBase {
  type: "checkpoint";
  privateSession: boolean;
  compressionStage: ContextCompressionStage;
  messages: MessageRecord[];
  objective: string;
  mode: InteractionMode;
  relevantMemoryIds: string[];
  persistCheckpoint: () => Promise<void>;
  persisted: boolean;
}

export interface HarnessCompletionEvent extends HarnessEventBase {
  type: "completion";
  toolResults: ToolResultRecord[];
  modelClaimsComplete: boolean;
  verificationEvidence: VerificationEvidence[];
  resolution?: { complete: boolean; reason: string };
}

export interface HarnessLifecycleEvent extends HarnessEventBase {
  type: "run-lifecycle";
  phase: "start" | "end";
  status?: "completed" | "stopped" | "failed" | "blocked";
}

export type HarnessEvent =
  | HarnessRequestEvent
  | HarnessContextBudgetEvent
  | HarnessSkillRoutingEvent
  | HarnessMemoryRetrievalEvent
  | HarnessToolCallEvent
  | HarnessCheckpointEvent
  | HarnessCompletionEvent
  | HarnessLifecycleEvent;

export type HarnessEventOf<TType extends HarnessEvent["type"]> = Extract<
  HarnessEvent,
  { type: TType }
>;

export interface HarnessMiddleware {
  id: HarnessMiddlewareId;
  version: string;
  execute(
    event: HarnessEvent,
    next: (event: HarnessEvent) => Promise<HarnessEvent>,
  ): Promise<HarnessEvent>;
}

export interface HarnessMiddlewareInspection {
  id: HarnessMiddlewareId;
  version: string;
  ownerId: string;
  protected: boolean;
}

export interface HarnessMiddlewareRegistryPort {
  register(middleware: HarnessMiddleware, ownerId: string): () => void;
  registerProtected(middleware: HarnessMiddleware, ownerId: string): void;
  dispatch<TType extends HarnessEvent["type"]>(
    event: HarnessEventOf<TType>,
  ): Promise<HarnessEventOf<TType>>;
  inspect(): readonly HarnessMiddlewareInspection[];
}

export interface LoopDetectionSignal {
  type: "repeated-tool-call" | "repeated-file-edit" | "unchanged-error-retry" | "no-progress";
  severity: "warning" | "stop";
  occurrences: number;
  summary: string;
}
