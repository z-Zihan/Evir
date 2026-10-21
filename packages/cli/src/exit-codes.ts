import { z } from "zod";
import { ProviderErrorType } from "../../../src/core/providers/stream-events";
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

/**
 * docs/20 §6.2: splits Provider errors into the credential/auth exit family
 * (3) and everything else (4). The CLI runs in Node, which has no browser
 * CORS policy, so CORS_BLOCKED can only reach here via the shared
 * `mapThrownError` (openai-chat-utils.ts) `streamStarted === false` branch:
 * it classifies Node fetch's pre-stream TypeError (connection refused, DNS
 * failure, etc.) as CORS_BLOCKED because that TypeError is indistinguishable
 * from a browser CORS rejection at the fetch layer. In the CLI that is a
 * network-family failure, not a credential one, so it maps to 4 here.
 * AUTH_FAILED/INSUFFICIENT_BALANCE are genuine credential/auth failures and
 * stay at 3.
 */
export function mapProviderErrorTypeToExitCode(type: ProviderErrorType): number {
  switch (type) {
    case ProviderErrorType.AUTH_FAILED:
    case ProviderErrorType.INSUFFICIENT_BALANCE:
      return 3;
    case ProviderErrorType.RATE_LIMITED:
    case ProviderErrorType.NETWORK_ERROR:
    case ProviderErrorType.MODEL_NOT_FOUND:
    case ProviderErrorType.CONTEXT_OVERFLOW:
    case ProviderErrorType.TOOL_CALL_UNSUPPORTED:
    case ProviderErrorType.VISION_UNSUPPORTED:
    case ProviderErrorType.PROTOCOL_INCOMPATIBLE:
    case ProviderErrorType.PROVIDER_ERROR:
    case ProviderErrorType.CORS_BLOCKED:
      return 4;
    case ProviderErrorType.CANCELLED:
      // Callers short-circuit on signal.aborted (130) before reaching this
      // mapping, so a stream error actually typed CANCELLED never flows
      // through here in practice. This case is a safety-net default only.
      return 4;
  }
}
