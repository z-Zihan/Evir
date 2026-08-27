import { describe, expect, it } from "vitest";

import { DEFAULT_GOAL_BUDGET, goalBudgetExceeded } from "../goal-budget";

describe("goalBudgetExceeded", () => {
  it("stays within default limits", () => {
    expect(goalBudgetExceeded(24, DEFAULT_GOAL_BUDGET.maxWallClockMs)).toBeNull();
  });

  it("blocks on node executions and wall clock with actionable reasons", () => {
    expect(goalBudgetExceeded(25, 0)).toContain("node executions");
    expect(goalBudgetExceeded(1, DEFAULT_GOAL_BUDGET.maxWallClockMs + 1)).toContain(
      "maximum runtime",
    );
    const limits = { maxNodeExecutions: 2, maxWallClockMs: 1000 };
    expect(goalBudgetExceeded(2, 1000, limits)).toBeNull();
    expect(goalBudgetExceeded(3, 0, limits)).toContain("node executions");
  });
});
