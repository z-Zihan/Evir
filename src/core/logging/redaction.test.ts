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
});
