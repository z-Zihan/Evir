import { describe, expect, it } from "vitest";
import { z } from "zod";
import { formatConfigError } from "../src/config-errors";
import { sharedProviderDocumentSchema } from "../src/types";

function parseError(document: unknown): z.ZodError {
  try {
    sharedProviderDocumentSchema.parse(document);
  } catch (error) {
    if (error instanceof z.ZodError) return error;
    throw error;
  }
  throw new Error("expected sharedProviderDocumentSchema.parse to throw");
}

describe("formatConfigError", () => {
  it("renders a single issue as a readable path and message", () => {
    const error = parseError({ version: 1, providers: [{ id: 123 }] });
    const message = formatConfigError(error);
    expect(message).toContain("providers[0].id");
    expect(message).not.toContain('{"expected"');
  });

  it("truncates after MAX_ISSUES and notes how many more remain", () => {
    const error = parseError({ version: 1, providers: [{}] });
    expect(error.issues.length).toBeGreaterThan(5);
    const message = formatConfigError(error);
    expect(message).toContain("… and");
  });

  it("passes through a plain Error message", () => {
    expect(formatConfigError(new Error("disk full"))).toBe("disk full");
  });

  it("returns a generic label for non-Error values", () => {
    expect(formatConfigError(undefined)).toBe("Unknown error");
  });
});
