export interface GoalBudgetLimits {
  maxNodeExecutions: number;
  maxWallClockMs: number;
  /** Total tokens (provider-reported or estimated) the whole goal may spend. */
  maxTokens: number;
}

export const DEFAULT_GOAL_BUDGET: GoalBudgetLimits = {
  maxNodeExecutions: 24,
  maxWallClockMs: 30 * 60_000,
  maxTokens: 2_000_000,
};

/**
 * Run-level guardrails so a goal can never spin without bound. Exceeding a
 * limit pauses the run as blocked (surfaced to the user) instead of silently
 * spawning more work.
 */
export function goalBudgetExceeded(
  nodeExecutions: number,
  elapsedMs: number,
  tokensSpent = 0,
  limits: GoalBudgetLimits = DEFAULT_GOAL_BUDGET,
): string | null {
  if (nodeExecutions > limits.maxNodeExecutions) {
    return "Goal budget exceeded: too many node executions";
  }
  if (elapsedMs > limits.maxWallClockMs) {
    return "Goal budget exceeded: maximum runtime reached";
  }
  if (tokensSpent > limits.maxTokens) {
    return "Goal budget exceeded: token budget reached";
  }
  return null;
}

/**
 * Sums provider-reported (or estimated) tokens recorded for this conversation
 * since the run started. Usage records are written per model request, so the
 * check between nodes reflects completed requests.
 */
export function tokensSpentSince(
  records: ReadonlyArray<{
    conversationId: string;
    createdAt: number;
    totalTokens?: number | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
  }>,
  conversationId: string,
  sinceMs: number,
): number {
  return records
    .filter(
      (record) =>
        record.conversationId === conversationId &&
        record.createdAt >= sinceMs &&
        typeof record.createdAt === "number",
    )
    .reduce(
      (sum, record) =>
        sum +
        (typeof record.totalTokens === "number"
          ? record.totalTokens
          : (record.inputTokens ?? 0) + (record.outputTokens ?? 0)),
      0,
    );
}
