import { describe, expect, it } from "vitest";
import type { UsageRecord } from "../../core/storage/db";
import { buildUsageAnalytics, buildUsageSeries } from "../usage-analytics";

const day = 86_400_000;
const now = new Date(2026, 7, 6).getTime();

function record(id: string, offset: number, modelId: string, tokens: number): UsageRecord {
  return {
    id,
    providerId: "provider",
    modelId,
    totalTokens: tokens,
    inputTokens: Math.round(tokens * 0.6),
    outputTokens: Math.round(tokens * 0.4),
    evidence: "provider",
    success: true,
    durationMs: 1200,
    createdAt: now + offset * day,
  };
}

describe("usage analytics", () => {
  it("aggregates totals, peaks, streaks, and models", () => {
    const analytics = buildUsageAnalytics(
      [
        record("a", -2, "model-a", 100),
        record("b", -1, "model-a", 300),
        record("c", 0, "model-b", 200),
      ],
      now,
    );

    expect(analytics.totalTokens).toBe(600);
    expect(analytics.peakRequestTokens).toBe(300);
    expect(analytics.peakDayTokens).toBe(300);
    expect(analytics.currentStreak).toBe(3);
    expect(analytics.longestStreak).toBe(3);
    expect(analytics.models[0]).toMatchObject({ modelId: "model-a", tokens: 400, requests: 2 });
    expect(analytics.heatmap).toHaveLength(365);
  });

  it("builds daily, weekly, and cumulative series", () => {
    const records = [record("a", -1, "model-a", 100), record("b", 0, "model-a", 200)];
    const daily = buildUsageSeries(records, "daily", "en", now);
    const weekly = buildUsageSeries(records, "weekly", "en", now);
    const cumulative = buildUsageSeries(records, "cumulative", "en", now);

    expect(daily).toHaveLength(30);
    expect(daily.at(-1)?.tokens).toBe(200);
    expect(weekly).toHaveLength(12);
    expect(weekly.at(-1)?.tokens).toBe(300);
    expect(cumulative.at(-1)?.tokens).toBe(300);
  });
});
