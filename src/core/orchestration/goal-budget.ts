export interface GoalBudgetLimits {
  maxNodeExecutions: number;
  maxWallClockMs: number;
}

export const DEFAULT_GOAL_BUDGET: GoalBudgetLimits = {
  maxNodeExecutions: 24,
  maxWallClockMs: 30 * 60_000,
};

/**
 * Run-level guardrails so a goal can never spin without bound. Exceeding a
 * limit pauses the run as blocked (surfaced to the user) instead of silently
 * spawning more work.
 */
export function goalBudgetExceeded(
  nodeExecutions: number,
  elapsedMs: number,
  limits: GoalBudgetLimits = DEFAULT_GOAL_BUDGET,
): string | null {
  if (nodeExecutions > limits.maxNodeExecutions) {
    return "Goal budget exceeded: too many node executions";
  }
  if (elapsedMs > limits.maxWallClockMs) {
    return "Goal budget exceeded: maximum runtime reached";
  }
  return null;
}
