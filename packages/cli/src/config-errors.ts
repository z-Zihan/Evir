import { z } from "zod";

const MAX_ISSUES = 5;

/**
 * Renders a ZodError as a short list of "path: message" segments instead of
 * the raw issues JSON. Non-Zod errors pass through as their plain message.
 */
export function formatConfigError(error: unknown): string {
  if (!(error instanceof z.ZodError)) {
    return error instanceof Error ? error.message : "Unknown error";
  }
  const segments = error.issues
    .slice(0, MAX_ISSUES)
    .map((issue) => `${z.core.toDotPath(issue.path) || "(root)"}: ${issue.message}`);
  const remaining = error.issues.length - MAX_ISSUES;
  if (remaining > 0) segments.push(`… and ${remaining} more`);
  return segments.join("; ");
}
