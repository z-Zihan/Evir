import type { UsageRecord } from "../core/storage/db";

export type UsageRange = "daily" | "weekly" | "cumulative";

export interface UsagePoint {
  key: string;
  label: string;
  tokens: number;
  requests: number;
}

export interface ModelUsage {
  modelId: string;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  requests: number;
  successRate: number;
}

export interface HeatmapDay {
  key: string;
  timestamp: number;
  tokens: number;
  level: 0 | 1 | 2 | 3 | 4;
}

export interface UsageAnalytics {
  totalTokens: number;
  peakRequestTokens: number;
  peakDayTokens: number;
  totalRequests: number;
  activeDays: number;
  currentStreak: number;
  longestStreak: number;
  models: ModelUsage[];
  heatmap: HeatmapDay[];
}

const DAY = 86_400_000;

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function dayKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function recordTokens(record: UsageRecord): number {
  return record.totalTokens ?? (record.inputTokens ?? 0) + (record.outputTokens ?? 0);
}

function calculateStreaks(activeTimestamps: number[], today: number): [number, number] {
  if (activeTimestamps.length === 0) return [0, 0];
  const unique = [...new Set(activeTimestamps)].sort((a, b) => a - b);
  let longest = 1;
  let run = 1;
  for (let index = 1; index < unique.length; index += 1) {
    const current = unique[index];
    const previous = unique[index - 1];
    if (current === undefined || previous === undefined) continue;
    run = current - previous === DAY ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  const active = new Set(unique);
  let cursor = active.has(today) ? today : today - DAY;
  let current = 0;
  while (active.has(cursor)) {
    current += 1;
    cursor -= DAY;
  }
  return [current, longest];
}

export function buildUsageAnalytics(records: UsageRecord[], now = Date.now()): UsageAnalytics {
  const dayTotals = new Map<string, number>();
  const activeTimestamps: number[] = [];
  const models = new Map<string, ModelUsage & { successes: number }>();
  let totalTokens = 0;
  let peakRequestTokens = 0;

  for (const record of records) {
    const tokens = recordTokens(record);
    const key = dayKey(record.createdAt);
    if (!dayTotals.has(key)) activeTimestamps.push(startOfDay(record.createdAt));
    dayTotals.set(key, (dayTotals.get(key) ?? 0) + tokens);
    totalTokens += tokens;
    peakRequestTokens = Math.max(peakRequestTokens, tokens);

    const current = models.get(record.modelId) ?? {
      modelId: record.modelId,
      tokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      requests: 0,
      successRate: 0,
      successes: 0,
    };
    current.tokens += tokens;
    current.inputTokens += record.inputTokens ?? 0;
    current.outputTokens += record.outputTokens ?? 0;
    current.requests += 1;
    current.successes += record.success ? 1 : 0;
    models.set(record.modelId, current);
  }

  const today = startOfDay(now);
  const [currentStreak, longestStreak] = calculateStreaks(activeTimestamps, today);
  const peakDayTokens = Math.max(0, ...dayTotals.values());
  const heatmapStart = today - 364 * DAY;
  const heatmapTotals = Array.from({ length: 365 }, (_, index) => {
    const timestamp = heatmapStart + index * DAY;
    return { timestamp, tokens: dayTotals.get(dayKey(timestamp)) ?? 0 };
  });
  const positive = heatmapTotals.map(({ tokens }) => tokens).filter((tokens) => tokens > 0);
  const heatmapPeak = Math.max(1, ...positive);

  return {
    totalTokens,
    peakRequestTokens,
    peakDayTokens,
    totalRequests: records.length,
    activeDays: dayTotals.size,
    currentStreak,
    longestStreak,
    models: [...models.values()]
      .map(({ successes, ...model }) => ({
        ...model,
        successRate: model.requests ? successes / model.requests : 0,
      }))
      .sort((a, b) => b.tokens - a.tokens),
    heatmap: heatmapTotals.map(({ timestamp, tokens }) => ({
      key: dayKey(timestamp),
      timestamp,
      tokens,
      level: (tokens === 0 ? 0 : Math.min(4, Math.ceil((tokens / heatmapPeak) * 4))) as
        0 | 1 | 2 | 3 | 4,
    })),
  };
}

function startOfWeek(timestamp: number): number {
  const day = startOfDay(timestamp);
  const weekday = new Date(day).getDay();
  return day - ((weekday + 6) % 7) * DAY;
}

export function buildUsageSeries(
  records: UsageRecord[],
  range: UsageRange,
  locale: string,
  now = Date.now(),
): UsagePoint[] {
  const count = range === "weekly" ? 12 : 30;
  const unit = range === "weekly" ? 7 * DAY : DAY;
  const end = range === "weekly" ? startOfWeek(now) : startOfDay(now);
  const start = end - (count - 1) * unit;
  const buckets = Array.from({ length: count }, (_, index) => ({
    timestamp: start + index * unit,
    tokens: 0,
    requests: 0,
  }));

  for (const record of records) {
    const timestamp =
      range === "weekly" ? startOfWeek(record.createdAt) : startOfDay(record.createdAt);
    const index = Math.round((timestamp - start) / unit);
    const bucket = buckets[index];
    if (bucket) {
      bucket.tokens += recordTokens(record);
      bucket.requests += 1;
    }
  }

  let cumulative = records
    .filter((record) => record.createdAt < start)
    .reduce((total, record) => total + recordTokens(record), 0);
  const formatter = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: range === "weekly" ? "numeric" : undefined,
  });

  return buckets.map((bucket) => {
    if (range === "cumulative") cumulative += bucket.tokens;
    return {
      key: String(bucket.timestamp),
      label: formatter.format(bucket.timestamp),
      tokens: range === "cumulative" ? cumulative : bucket.tokens,
      requests: bucket.requests,
    };
  });
}
