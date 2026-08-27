import { describe, expect, it, vi } from "vitest";

import { Logger, logCategoryOf } from "../logger";
import type { LogCategory, LogSink } from "../types";

function recordingSink(failures = 0): LogSink & {
  appended: Array<{ category: LogCategory; line: string }>;
} {
  const appended: Array<{ category: LogCategory; line: string }> = [];
  let failuresLeft = failures;
  return {
    directory: "/tmp/evir-logs",
    appended,
    append: (category: LogCategory, line: string) => {
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        return Promise.reject(new Error("disk full"));
      }
      appended.push({ category, line });
      return Promise.resolve();
    },
  };
}

describe("logCategoryOf", () => {
  it("maps audit, performance, and app channels", () => {
    expect(logCategoryOf("approval")).toBe("audit");
    expect(logCategoryOf("tool")).toBe("audit");
    expect(logCategoryOf("security")).toBe("audit");
    expect(logCategoryOf("usage")).toBe("performance");
    expect(logCategoryOf("performance")).toBe("performance");
    expect(logCategoryOf("provider")).toBe("app");
    expect(logCategoryOf("mcp")).toBe("app");
  });
});

describe("Logger persistence", () => {
  it("buffers queued lines and flushes them as JSON per category", async () => {
    const logger = new Logger();
    const sink = recordingSink();
    logger.attachSink(sink);
    logger.info("provider", "provider.request-completed", { requestId: "r-1" });
    logger.info("approval", "approval.granted", { runId: "run-1" });
    await logger.flush();

    expect(sink.appended.map((entry) => entry.category)).toEqual(["app", "audit"]);
    const parsed = sink.appended.map((entry) => JSON.parse(entry.line) as { event?: string });
    expect(parsed[0]).toMatchObject({ event: "provider.request-completed", requestId: "r-1" });
    expect(parsed[1]).toMatchObject({ event: "approval.granted", runId: "run-1" });
  });

  it("flushes error and audit events immediately", async () => {
    const logger = new Logger();
    const sink = recordingSink();
    logger.attachSink(sink);
    logger.error("provider", "provider.request-failed", { errorType: "TIMEOUT" });
    // No explicit flush() call: error events must not wait for the timer.
    await vi.waitFor(() => expect(sink.appended.length).toBe(1));
    expect(JSON.parse(sink.appended[0]?.line ?? "null")).toMatchObject({
      event: "provider.request-failed",
      level: "error",
    });
  });

  it("drops the oldest queued lines above the queue cap without throwing", async () => {
    const logger = new Logger();
    const sink = recordingSink();
    const appendOriginal = sink.append.bind(sink);
    let releaseGate: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    sink.append = (category: LogCategory, line: string) =>
      gate.then(() => appendOriginal(category, line));
    logger.attachSink(sink);
    for (let index = 0; index < 600; index += 1) {
      logger.info("app", `app.event-${index}`, { index });
    }
    releaseGate();
    await logger.flush();

    // Some entries were dropped once the queue cap was hit, and every persisted
    // line still parses.
    expect(sink.appended.length).toBeLessThan(600);
    expect(logger.getEntries().length).toBeLessThanOrEqual(1000);
    for (const entry of sink.appended) {
      expect(() => void JSON.parse(entry.line)).not.toThrow();
    }
  });

  it("disables the sink after repeated failures and keeps logging in memory", async () => {
    const logger = new Logger();
    const sink = recordingSink(Number.MAX_SAFE_INTEGER);
    logger.attachSink(sink);
    logger.error("app", "app.failure-1");
    logger.error("app", "app.failure-2");
    logger.error("app", "app.failure-3");
    await logger.flush();

    expect(logger.persistenceStatus()).toEqual({ active: false, directory: "/tmp/evir-logs" });
    expect(
      logger.getEntries().some((entry) => entry.event === "app.log-persistence-disabled"),
    ).toBe(true);

    expect(() => logger.info("app", "app.after-disabled")).not.toThrow();
    expect(logger.getEntries().some((entry) => entry.event === "app.after-disabled")).toBe(true);
  });

  it("persists events logged before the sink was attached", async () => {
    const logger = new Logger();
    logger.info("app", "app.session-started", { target: "desktop" });
    const sink = recordingSink();
    logger.attachSink(sink);
    await logger.flush();

    expect(sink.appended).toHaveLength(1);
    expect(JSON.parse(sink.appended[0]?.line ?? "null")).toMatchObject({
      event: "app.session-started",
    });
  });

  it("reports inactive persistence before a sink is attached", () => {
    const logger = new Logger();
    expect(logger.persistenceStatus()).toEqual({ active: false, directory: null });
  });
});
