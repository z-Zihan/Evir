import { describe, expect, it } from "vitest";

import { redactLogValue } from "./redaction";

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
