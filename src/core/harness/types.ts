export type HarnessMiddlewareId =
  | "input-normalization"
  | "mode-policy"
  | "capability-gate"
  | "context-budget"
  | "skill-routing"
  | "tool-policy"
  | "loop-detection"
  | "checkpoint"
  | "verification"
  | "observability";

export interface HarnessContext {
  conversationId: string;
  runId?: string;
  mode: "ask" | "plan" | "agent";
  providerId: string;
  modelId: string;
  iteration: number;
  metadata: Record<string, unknown>;
}

export interface HarnessMiddlewareResult {
  context: HarnessContext;
  blocked: boolean;
  blockReason?: string;
}

export interface HarnessMiddleware {
  id: HarnessMiddlewareId;
  version: string;
  execute(
    context: HarnessContext,
    next: (context: HarnessContext) => Promise<HarnessMiddlewareResult>,
  ): Promise<HarnessMiddlewareResult>;
}

export interface LoopDetectionSignal {
  type:
    | "repeated-tool-call"
    | "repeated-file-edit"
    | "unchanged-error-retry"
    | "no-progress";
  severity: "warning" | "stop";
  occurrences: number;
  summary: string;
}
