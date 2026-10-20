import { z } from "zod";
import { NotConfiguredError } from "./config-store";

/**
 * Carries the docs/20 §6.2 exit code alongside the human message, so
 * throw sites can pick the final process exit code without main()'s
 * top-level catch re-deriving it from the error's shape.
 */
export class CliExitError extends Error {
  readonly exitCode: number;

  constructor(exitCode: number, message: string) {
    super(message);
    this.name = "CliExitError";
    this.exitCode = exitCode;
  }
}

export function toExitCode(error: unknown): number {
  if (error instanceof CliExitError) return error.exitCode;
  if (error instanceof z.ZodError) return 2;
  if (error instanceof NotConfiguredError) return 2;
  return 1;
}
