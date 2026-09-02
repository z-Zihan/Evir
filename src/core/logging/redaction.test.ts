import { describe, expect, it } from "vitest";

import { redactLogValue } from "./redaction";
import { Logger } from "./logger";

describe("redactLogValue", () => {
  it("redacts sensitive keys recursively", () => {
    expect(
      redactLogValue({
        apiKey: "secret",
        nested: { authorization: "Bearer value" },
      }),
    ).toEqual({
      apiKey: "[REDACTED]",
      nested: { authorization: "[REDACTED]" },
    });
  });

  it("redacts common secret-like values", () => {
    expect(redactLogValue("Authorization: Bearer abcdefghijklmnop")).toBe(
      "Authorization: [REDACTED]",
    );
  });

  it("preserves numeric usage fields whose names end in Tokens", () => {
    expect(
      redactLogValue({ inputTokens: 12, outputTokens: 7, totalTokens: 19, accessToken: "secret" }),
    ).toEqual({
      inputTokens: 12,
      outputTokens: 7,
      totalTokens: 19,
      accessToken: "[REDACTED]",
    });
  });

  it("preserves token timing metrics while redacting credential-shaped token keys", () => {
    expect(
      redactLogValue({
        firstTokenMs: 213,
        tokensPerSecond: 48.6,
        sessionToken: "abc123",
      }),
    ).toEqual({
      firstTokenMs: 213,
      tokensPerSecond: 48.6,
      sessionToken: "[REDACTED]",
    });
  });

  it("removes URL credentials, query parameters, and fragments from log fields", () => {
    expect(
      redactLogValue({
        target: "https://user:pass@example.com/path?token=secret#section",
        url: "http://localhost:1420/callback?code=oauth-code",
      }),
    ).toEqual({
      target: "https://example.com/path",
      url: "http://localhost:1420/callback",
    });
  });
});

describe("Logger subscriptions", () => {
  it("notifies diagnostics on changes without idle polling", () => {
    const logger = new Logger();
    let changes = 0;
    const unsubscribe = logger.subscribe(() => {
      changes += 1;
    });

    logger.info("app", "started");
    logger.clear();
    unsubscribe();
    logger.info("app", "after unsubscribe");

    expect(changes).toBe(2);
  });

  it("promotes correlation and timing fields into the unified event envelope", () => {
    const logger = new Logger();
    logger.info("provider", "provider.request-completed", {
      conversationId: "conversation-1",
      projectId: "project-1",
      runId: "run-1",
      planId: "plan-1",
      toolCallId: "tool-1",
      requestId: "request-1",
      browserSessionId: "browser-1",
      actionId: "action-1",
      evidenceId: "evidence-1",
      durationMs: 42,
      modelId: "model-1",
    });

    expect(logger.getEntries()[0]).toMatchObject({
      conversationId: "conversation-1",
      threadId: "conversation-1",
      projectId: "project-1",
      runId: "run-1",
      planId: "plan-1",
      toolCallId: "tool-1",
      requestId: "request-1",
      browserSessionId: "browser-1",
      actionId: "action-1",
      evidenceId: "evidence-1",
      durationMs: 42,
      data: { modelId: "model-1" },
    });
    expect(logger.getEntries()[0]?.windowId).toBeTruthy();
  });

  it("inherits bound action, project, run, and plan IDs across one conversation", () => {
    const logger = new Logger();
    logger.bindConversationCorrelation("conversation-1", {
      actionId: "action-1",
      projectId: "project-1",
      runId: "run-1",
      planId: "plan-1",
    });
    logger.info("tool", "tool.completed", {
      conversationId: "conversation-1",
      toolCallId: "tool-1",
    });

    expect(logger.getEntries()[0]).toMatchObject({
      conversationId: "conversation-1",
      threadId: "conversation-1",
      projectId: "project-1",
      runId: "run-1",
      planId: "plan-1",
      actionId: "action-1",
      toolCallId: "tool-1",
    });
    expect(logger.latestActionId()).toBe("action-1");
  });
});
