import { describe, expect, it } from "vitest";

import { DEFAULT_GOAL_BUDGET, goalBudgetExceeded, tokensSpentSince } from "../goal-budget";

describe("goalBudgetExceeded", () => {
  it("stays within default limits", () => {
    expect(
      goalBudgetExceeded(24, DEFAULT_GOAL_BUDGET.maxWallClockMs, DEFAULT_GOAL_BUDGET.maxTokens),
    ).toBeNull();
  });

  it("blocks on node executions, wall clock, and tokens with actionable reasons", () => {
    expect(goalBudgetExceeded(25, 0, 0)).toContain("node executions");
    expect(goalBudgetExceeded(1, DEFAULT_GOAL_BUDGET.maxWallClockMs + 1, 0)).toContain(
      "maximum runtime",
    );
    expect(goalBudgetExceeded(1, 0, DEFAULT_GOAL_BUDGET.maxTokens + 1)).toContain("token budget");
    const limits = { maxNodeExecutions: 2, maxWallClockMs: 1000, maxTokens: 1000 };
    expect(goalBudgetExceeded(2, 1000, 1000, limits)).toBeNull();
    expect(goalBudgetExceeded(3, 0, 0, limits)).toContain("node executions");
  });

  it("sums provider or estimated tokens recorded since the run started", () => {
    const records = [
      { conversationId: "c", createdAt: 10, totalTokens: 100 },
      { conversationId: "c", createdAt: 5, totalTokens: 999 },
      { conversationId: "c", createdAt: 20, inputTokens: 30, outputTokens: 12 },
      { conversationId: "other", createdAt: 20, totalTokens: 5000 },
      { conversationId: "c", createdAt: 30 },
    ];
    expect(tokensSpentSince(records, "c", 10)).toBe(142);
  });
});
